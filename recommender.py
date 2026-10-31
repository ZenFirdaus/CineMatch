"""
recommender.py
Content-Based Filtering engine for MovieLens dataset.
Loaded once at Flask startup; all methods are pure (no side-effects).
"""

import os
import re
import pandas as pd
import numpy as np
from sklearn.preprocessing import MultiLabelBinarizer

# ── Mood → genre mapping (heuristic) ─────────────────────────────────────────
MOOD_GENRES = {
    "Comedy":    ["Comedy"],
    "Emotional": ["Drama", "Romance"],
    "Dark":      ["Crime", "Thriller", "Horror", "Film-Noir"],
    "Action":    ["Action", "Adventure"],
    "Thriller":  ["Thriller", "Mystery", "Crime"],
    "Relaxing":  ["Animation", "Children", "Musical", "Documentary"],
}

# ── Duration buckets (heuristic, dataset has no runtime) ─────────────────────
# We use rating_count as a loose proxy: blockbusters (high count) tend to be
# longer; documentaries / shorts tend to be lower-count. This is explicitly
# labeled "preference match" rather than actual runtime.
DURATION_SCORE = {
    "short":   lambda rc: 1.0 if rc < 200   else 0.6,
    "medium":  lambda rc: 1.0 if 200 <= rc < 2000 else 0.7,
    "long":    lambda rc: 1.0 if rc >= 2000  else 0.6,
    "any":     lambda rc: 1.0,
}

# Languages that are over-represented in MovieLens (English is dominant).
# We can only approximate via genre/era heuristics since the dataset has
# no language column.  Language filter is noted as best-effort.

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


class Recommender:
    """Singleton-style recommender. Call load() once then use recommend()."""

    def __init__(self):
        self.movies: pd.DataFrame = None
        self.genre_matrix: pd.DataFrame = None
        self.mlb: MultiLabelBinarizer = None
        self.year_min: int = 1874
        self.year_max: int = 2023
        self.all_genres: list = []
        self.loaded: bool = False

    # ── Data loading ──────────────────────────────────────────────────────────
    def load(self):
        print("[Recommender] Loading movies …")
        movies = pd.read_csv(os.path.join(BASE_DIR, "movies.csv"))

        # ── Ratings: gunakan cache CSV agar startup cepat ─────────────────
        cache_path = os.path.join(BASE_DIR, "ratings_agg_cache.csv")
        if os.path.exists(cache_path):
            print("[Recommender] Loading ratings dari cache …")
            agg = pd.read_csv(cache_path)
        else:
            print("[Recommender] Loading ratings (pertama kali, ~5 detik) …")
            ratings = pd.read_csv(
                os.path.join(BASE_DIR, "ratings.csv"),
                usecols=["movieId", "rating"],
            )
            agg = (
                ratings.groupby("movieId")
                .agg(avg_rating=("rating", "mean"), rating_count=("rating", "count"))
                .reset_index()
            )
            agg.to_csv(cache_path, index=False)
            print(f"[Recommender] Cache disimpan → {cache_path}")

        print("[Recommender] Loading links …")
        links = pd.read_csv(
            os.path.join(BASE_DIR, "links.csv"),
            usecols=["movieId", "tmdbId", "imdbId"],
        )
        links["tmdbId"] = links["tmdbId"].fillna(0).astype(int)
        links["imdbId"] = links["imdbId"].astype(str).str.zfill(7)

        # Year extraction
        movies["year"] = (
            movies["title"].str.extract(r"\((\d{4})\)$").astype("Int64")
        )
        movies["clean_title"] = (
            movies["title"]
            .str.replace(r"\s*\(\d{4}\)$", "", regex=True)
            .str.strip()
        )

        # Genre list
        movies["genre_list"] = movies["genres"].apply(
            lambda g: [] if g == "(no genres listed)" else g.split("|")
        )

        movies = movies.merge(agg, on="movieId", how="left")
        movies["avg_rating"] = movies["avg_rating"].fillna(0.0).round(2)
        movies["rating_count"] = movies["rating_count"].fillna(0).astype(int)

        # Merge links for poster generation
        movies = movies.merge(links, on="movieId", how="left")
        movies["tmdbId"] = movies["tmdbId"].fillna(0).astype(int)

        # Genre binarization
        self.mlb = MultiLabelBinarizer()
        genre_matrix = self.mlb.fit_transform(movies["genre_list"])
        self.genre_matrix = pd.DataFrame(
            genre_matrix, columns=self.mlb.classes_, index=movies.index
        )

        valid_years = sorted(
            movies["year"].dropna().unique().astype(int).tolist()
        )
        self.year_min = valid_years[0] if valid_years else 1874
        self.year_max = valid_years[-1] if valid_years else 2023
        self.all_genres = sorted(
            g for g in self.mlb.classes_ if g not in ("", "(no genres listed)")
        )
        self.movies = movies
        self.loaded = True
        print(
            f"[Recommender] Ready. {len(movies):,} movies | "
            f"years {self.year_min}–{self.year_max}"
        )

    # ── Core recommendation ───────────────────────────────────────────────────
    def recommend(
        self,
        liked_genres: list,
        disliked_genres: list,
        min_rating: float,
        year_from: int,
        year_to: int,
        moods: list,
        duration: str,
        age: int,
        top_n: int = 150,
    ) -> dict:
        """
        Returns dict with keys: top, best_match, more
        Each value is a list of movie dicts.
        """
        if not self.loaded:
            raise RuntimeError("Recommender not loaded. Call load() first.")

        df = self.movies.copy()

        # ── Hard filters ─────────────────────────────────────────────────────
        df = df[df["year"].notna()]
        df = df[(df["year"] >= year_from) & (df["year"] <= year_to)]
        df = df[(df["avg_rating"] >= min_rating) & (df["rating_count"] >= 10)]

        if df.empty:
            return {"top": [], "best_match": [], "more": [], "total": 0}

        # ── Disliked genre filter ─────────────────────────────────────────────
        if disliked_genres:
            valid_dis = [g for g in disliked_genres if g in self.genre_matrix.columns]
            if valid_dis:
                dis_mask = self.genre_matrix.loc[df.index, valid_dis].sum(axis=1) == 0
                df = df[dis_mask.values]

        if df.empty:
            return {"top": [], "best_match": [], "more": [], "total": 0}

        # ── Genre score ───────────────────────────────────────────────────────
        # Combine liked genres + mood genres
        mood_genres = []
        for m in moods:
            mood_genres += MOOD_GENRES.get(m, [])

        all_liked = list(set(liked_genres + mood_genres))
        valid_liked = [g for g in all_liked if g in self.genre_matrix.columns]

        sub_gm = self.genre_matrix.loc[df.index]

        if valid_liked:
            genre_score = sub_gm[valid_liked].sum(axis=1) / len(valid_liked)
        else:
            genre_score = pd.Series(1.0, index=df.index)

        # ── Age-based soft filter ─────────────────────────────────────────────
        # Heuristic: younger users get a slight boost to animated/children films
        age_bonus = pd.Series(0.0, index=df.index)
        if age and age < 18 and "Children" in self.genre_matrix.columns:
            age_bonus += sub_gm["Children"] * 0.1
            if "Animation" in self.genre_matrix.columns:
                age_bonus += sub_gm["Animation"] * 0.05
        elif age and age >= 60:
            if "Drama" in self.genre_matrix.columns:
                age_bonus += sub_gm["Drama"] * 0.05

        # ── Duration score ────────────────────────────────────────────────────
        dur_fn = DURATION_SCORE.get(duration, DURATION_SCORE["any"])
        dur_score = df["rating_count"].apply(dur_fn)

        # ── Normalised rating ─────────────────────────────────────────────────
        max_r = df["avg_rating"].max() if df["avg_rating"].max() > 0 else 1
        norm_rating = df["avg_rating"] / max_r

        # ── Popularity (log-scaled) ───────────────────────────────────────────
        max_rc = df["rating_count"].max() if df["rating_count"].max() > 0 else 1
        pop_score = np.log1p(df["rating_count"]) / np.log1p(max_rc)

        # ── Final composite score ─────────────────────────────────────────────
        df = df.copy()
        df["genre_score"]  = genre_score.values
        df["dur_score"]    = dur_score.values
        df["norm_rating"]  = norm_rating.values
        df["pop_score"]    = pop_score.values
        df["age_bonus"]    = age_bonus.values
        df["score"] = (
            df["genre_score"] * 0.45
            + df["norm_rating"] * 0.30
            + df["pop_score"]  * 0.15
            + df["dur_score"]  * 0.07
            + df["age_bonus"]  * 0.03
        ).round(4)

        # Drop zero genre score when genres were specified
        if valid_liked:
            df = df[df["genre_score"] > 0]

        df = df.sort_values(
            ["score", "avg_rating", "rating_count"], ascending=False
        )
        df = df.head(top_n)

        records = [self._to_dict(row) for _, row in df.iterrows()]

        # ── Partition results ─────────────────────────────────────────────────
        top        = records[:5]            # hero top picks
        best_match = records[5:35]          # best match section
        more       = records[35:]           # discover more

        return {
            "top": top,
            "best_match": best_match,
            "more": more,
            "total": len(records),
        }

    # ── Search ────────────────────────────────────────────────────────────────
    def search(self, query: str, limit: int = 30) -> list:
        q = query.strip().lower()
        if not q or not self.loaded:
            return []
        mask = self.movies["clean_title"].str.lower().str.contains(
            re.escape(q), na=False
        )
        results = self.movies[mask].sort_values("rating_count", ascending=False)
        return [self._to_dict(row) for _, row in results.head(limit).iterrows()]

    # ── Movie detail ──────────────────────────────────────────────────────────
    def get_movie(self, movie_id: int) -> dict | None:
        row = self.movies[self.movies["movieId"] == movie_id]
        if row.empty:
            return None
        return self._to_dict(row.iloc[0])

    # ── Helper ────────────────────────────────────────────────────────────────
    def _to_dict(self, row) -> dict:
        tmdb_id = int(row.get("tmdbId", 0) or 0)
        imdb_id = str(row.get("imdbId", "") or "")
        return {
            "id":           int(row["movieId"]),
            "title":        row["clean_title"],
            "year":         int(row["year"]) if pd.notna(row.get("year")) else None,
            "genres":       row["genre_list"],
            "avg_rating":   float(row["avg_rating"]),
            "rating_count": int(row["rating_count"]),
            "score":        float(row.get("score", 0)),
            "tmdb_id":      tmdb_id,
            "imdb_id":      imdb_id,
            # Poster: use TMDB path pattern (requires no API key for img CDN)
            # Falls back to placeholder if tmdb_id is 0
            "poster_url":   (
                f"https://image.tmdb.org/t/p/w342/{tmdb_id}.jpg"
                if tmdb_id > 0
                else None
            ),
        }


# ── Singleton instance ────────────────────────────────────────────────────────
recommender = Recommender()
