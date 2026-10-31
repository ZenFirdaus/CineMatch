"""
app.py  –  Flask backend for Movie Recommendation System
"""

from flask import Flask, render_template, request, jsonify
from recommender import recommender

app = Flask(
    __name__,
    template_folder="templates",
    static_folder="static",
    static_url_path="/static",
)

# ── Load data at startup ──────────────────────────────────────────────────────
with app.app_context():
    recommender.load()


# ── Pages ─────────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


# ── API: metadata ─────────────────────────────────────────────────────────────
@app.route("/api/metadata")
def metadata():
    return jsonify(
        {
            "genres":   recommender.all_genres,
            "year_min": recommender.year_min,
            "year_max": recommender.year_max,
            "moods":    ["Comedy", "Emotional", "Dark", "Action", "Thriller", "Relaxing"],
            "durations": [
                {"value": "any",    "label": "Any Length"},
                {"value": "short",  "label": "Short (< ~90 min)"},
                {"value": "medium", "label": "Medium (~90–150 min)"},
                {"value": "long",   "label": "Long (> ~150 min)"},
            ],
        }
    )


# ── API: recommendations ──────────────────────────────────────────────────────
@app.route("/api/recommend", methods=["POST"])
def get_recommendations():
    data = request.get_json(force=True)

    liked_genres    = data.get("liked_genres", [])
    disliked_genres = data.get("disliked_genres", [])
    min_rating      = float(data.get("min_rating", 0.0))
    year_from       = int(data.get("year_from", recommender.year_min))
    year_to         = int(data.get("year_to", recommender.year_max))
    moods           = data.get("moods", [])
    duration        = data.get("duration", "any")
    age             = data.get("age")
    age             = int(age) if age is not None else None

    # Clamp inputs
    min_rating = max(0.0, min(5.0, min_rating))
    year_from  = max(recommender.year_min, min(recommender.year_max, year_from))
    year_to    = max(recommender.year_min, min(recommender.year_max, year_to))
    if year_from > year_to:
        year_from, year_to = year_to, year_from

    results = recommender.recommend(
        liked_genres    = liked_genres,
        disliked_genres = disliked_genres,
        min_rating      = min_rating,
        year_from       = year_from,
        year_to         = year_to,
        moods           = moods,
        duration        = duration,
        age             = age,
    )
    return jsonify(results)


# ── API: search ───────────────────────────────────────────────────────────────
@app.route("/api/search")
def search_movies():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"results": []})
    results = recommender.search(q, limit=20)
    return jsonify({"results": results})


# ── API: movie detail ─────────────────────────────────────────────────────────
@app.route("/api/movie/<int:movie_id>")
def movie_detail(movie_id):
    movie = recommender.get_movie(movie_id)
    if not movie:
        return jsonify({"error": "Not found"}), 404
    return jsonify(movie)


if __name__ == "__main__":
    app.run(debug=False, port=5001)
