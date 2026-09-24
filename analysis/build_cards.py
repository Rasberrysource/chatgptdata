"""Compute the data behind the record cards and write cards/index.html.

Inputs: data/ratings.csv, data/reviews.csv (Letterboxd export) and
data/film_meta.csv (from enrich_wikidata.py).
The page template is analysis/cards_template.html; this script replaces the
/*__DATA__*/ marker in it with the computed JSON.
"""
import json
import pathlib
import re

import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "analysis" / "cards_template.html"
OUT = ROOT / "cards" / "index.html"

NUMBERED = r"(?:^|\n)\s*1\.\s"
SIGNATURE = r"\n?@[^\n]*$"


def load():
    r = pd.read_csv(ROOT / "data" / "ratings.csv")
    v = pd.read_csv(ROOT / "data" / "reviews.csv", parse_dates=["Watched Date"])
    v["W"] = v["Watched Date"]
    v["text"] = v["Review"].astype(str).str.replace("\r\n", "\n")
    return r, v


def excerpt(v, name, date, *parts):
    """Return exact substrings of one review, failing loudly if the text drifted."""
    row = v[(v.Name == name) & (v.W == date)]
    assert len(row) == 1, (name, date)
    text = row.text.iloc[0]
    for p in parts:
        assert p in text, (name, p)
    return {"film": name, "date": date, "rating": float(row.Rating.iloc[0]), "lines": list(parts)}


# ---------------------------------------------------------------- card 1: style

def style_card(v):
    body = v.text.str.replace(SIGNATURE, "", regex=True).str.strip()
    d = v.assign(
        year=v.W.dt.year,
        length=body.str.replace(r"\s+", " ", regex=True).str.len(),
        numbered=v.text.str.contains(NUMBERED),
        paragraphs=body.str.contains(r"\n\s*\n") & ~body.str.contains(NUMBERED),
        question=v.text.str.contains(r"\?"),
        exclaim=v.text.str.contains("!"),
        english=~v.text.str.contains(r"[가-힣]") | v.text.str.contains(r"-{4}"),
        by_the_way=body.str.contains("그나저나"),
        guillemet=body.str.contains("《"),
    )
    d = d[d.year >= 2016]
    g = d.groupby("year")
    years = [
        {
            "year": int(y),
            "n": int(len(s)),
            "median_len": int(s.length.median()),
            "numbered": round(s.numbered.mean() * 100),
            "paragraphs": round(s.paragraphs.mean() * 100),
            "question": round(s.question.mean() * 100),
            "exclaim": round(s.exclaim.mean() * 100),
            "english": int(s.english.sum()),
            "by_the_way": int(s.by_the_way.sum()),
            "guillemet": int(s.guillemet.sum()),
        }
        for y, s in g
    ]

    def era_stats(a, b):
        s = d[d.year.between(a, b)]
        return {
            "n": int(len(s)),
            "median_len": int(s.length.median()),
            "numbered": round(s.numbered.mean() * 100),
            "paragraphs": round(s.paragraphs.mean() * 100),
            "english": int(s.english.sum()),
            "by_the_way": int(s.by_the_way.sum()),
        }

    eras = [
        {
            "span": "2016–2018",
            "name": "짧은 메모와 영어 병기",
            "stats": era_stats(2016, 2018),
            "note": "리뷰 길이의 중앙값이 90자 아래였습니다. 영어로만 쓰거나 영어와 한국어를 함께 쓴 리뷰가 이 시기에 몰려 있습니다.",
            "quote": excerpt(v, "Now You See Me", "2018-01-21",
                             "We don't have to emphasize reality in entertainment movies, right?",
                             "오락영화에 굳이 현실성을 강조할 필요는 없잖아요?"),
        },
        {
            "span": "2019–2021",
            "name": "번호 목록 전성기",
            "stats": era_stats(2019, 2021),
            "note": "생각을 1, 2, 3으로 나눠 적는 형식이 2021년에 리뷰 10편 중 7편까지 늘었습니다. 물음표가 들어간 리뷰도 2021년에 48%로 가장 많았습니다.",
            "quote": excerpt(v, "Millennium Actress", "2021-10-24",
                             "1. 콘 사토시… 코지마 히데오처럼 영화 감독 되려다가 대신 애니메이션에 입성한 것 아닌가 싶다.",
                             "3. 자신을 언제나 아이처럼 좋아할 수 있는 팬과 함께라면, 그 무엇도 두렵지 않으리라."),
        },
        {
            "span": "2022–2025",
            "name": "두 문단과 '그나저나'",
            "stats": era_stats(2022, 2025),
            "note": "번호 대신 문단을 나눠 쓰기 시작했습니다. 첫 문단에 감상을 쓰고, 둘째 문단을 '그나저나'로 시작해 곁가지 이야기를 붙이는 구성이 자주 보입니다.",
            "quote": excerpt(v, "(OO)", "2023-03-28",
                             "모두가 경험했기에 보기 더 괴로운 순간은 미칠듯이 괴롭고, 해결되는 순간은 너무나 상쾌하게 그려낸다.",
                             "그나저나 이 양반 묘사가 심상치 않은 거 보니, 적어도 비염 환자거나 그 가족이겠구만."),
        },
        {
            "span": "2026",
            "name": "짧고 담백하게",
            "stats": era_stats(2026, 2026),
            "note": "두 문단 구성은 유지하면서 길이가 절반 이하로 줄었습니다. 번호 목록은 한 번도 쓰지 않았고, 물음표도 거의 사라졌습니다.",
            "quote": excerpt(v, "Marty Supreme", "2026-07-04",
                             "꿈이란 걸 좇을 수 있는 인간의 자격을 훅 물어보는 형 사프디의 묵직한 질문이, 미래지향적 드럼리스 사운드와 함께 훅 들어오다.",
                             "브리티시 인베이전 이전에도 미국은 아주 그냥 폭발 직전이었구만."),
        },
    ]
    first_guillemet = d[d.guillemet].sort_values("W").iloc[0]
    return {
        "years": years,
        "eras": eras,
        "by_the_way_total": int(d.by_the_way.sum()),
        "first_guillemet": {"film": first_guillemet.Name, "date": str(first_guillemet.W.date())},
    }


# ---------------------------------------------------------- card 2: revisions

FORMAT_KO = {
    "cinema": "극장", "netflix": "넷플릭스", "tving": "티빙", "tv": "TV", "imax": "IMAX",
    "3d": "3D", "4dx": "4DX", "screenx": "ScreenX", "preview": "시사회",
    "dubbed in korean": "더빙", "extended cut": "감독판",
}

REASONS = {
    "The Grand Budapest Hotel": ("극장 화면으로 다시 봄", ["이건 극장에서 봐야 하는 거다.", "고마워서 0.5점 추가."]),
    "Incredibles 2": ("엔딩 크레디트", ["스탭롤 때문에 0.5점 추가."]),
    "Escape from Mogadishu": ("다시 보니 보인 메타포", ["남북관계 메타포 꽉꽉 잘 채워놨다 진짜."]),
    "Avengers: Endgame": ("옆자리 관객", ["3회차에 왼쪽 애들이 떠들기까지 하니 집중하는 게 쉽지 않았어…"]),
    "Captain Marvel": ("두 번째에 보인 약점", ["고난과 역경이 없는 히어로라고 말이 많던데, 왜 그런 말이 나오는지 알 거 같다."]),
    "Believer": ("감독판도 그대로", ["처음 극장판을 봤을 때의 아쉬움과 당혹스러움도 다 그대로다."]),
    "The Drug King": ("시사회 다음 일반 상영", ["뭔 이야기를 하고 싶은 건지."]),
}


def formats(tags):
    parts = [t.strip() for t in str(tags).split(",") if t.strip()]
    ko = [FORMAT_KO.get(p, p) for p in parts]
    # "극장, IMAX" reads better as just "IMAX"; special screens and previews imply a cinema.
    if "극장" in ko and {"IMAX", "3D", "4DX", "ScreenX", "시사회"} & set(ko):
        ko.remove("극장")
    return " ".join(ko)


def revision_card(r, v):
    logs = v.dropna(subset=["W"]).sort_values("W")
    multi = logs.groupby(["Name", "Year"]).filter(lambda s: len(s) > 1)
    films = []
    for (name, _), s in multi.groupby(["Name", "Year"]):
        if s.Rating.nunique() == 1:
            continue
        rows = list(s.itertuples())
        change = next(i for i in range(1, len(rows)) if rows[i].Rating != rows[i - 1].Rating)
        before, after = rows[change - 1], rows[change]
        reason, lines = REASONS[name]
        for line in lines:
            assert line in after.text, (name, line)
        films.append({
            "film": name,
            "before": float(before.Rating), "after": float(after.Rating),
            "before_date": str(before.W.date()), "after_date": str(after.W.date()),
            "before_fmt": formats(before.Tags), "after_fmt": formats(after.Tags),
            "days": int((after.W - before.W).days),
            "viewing": change + 1,
            "reason": reason, "quote": lines,
        })
    films.sort(key=lambda f: (f["after"] - f["before"], f["days"]), reverse=True)
    n_multi = multi.groupby(["Name", "Year"]).ngroups
    current = r.set_index(["Name", "Year"]).Rating
    last = logs.groupby(["Name", "Year"]).Rating.last()
    assert (current.reindex(last.index) == last).all(), "current rating differs from last diary entry"
    return {
        "multi_films": int(n_multi),
        "changed": len(films),
        "kept": int(n_multi - len(films)),
        "up": sum(f["after"] > f["before"] for f in films),
        "down": sum(f["after"] < f["before"] for f in films),
        "films": films,
    }


# ------------------------------------------------------------ card 3: directors

def with_meta(r, v, meta):
    films = r.merge(meta[["uri", "qid", "directors", "director_qids", "genres_en", "types_en", "runtime", "countries"]],
                    left_on="Letterboxd URI", right_on="uri", how="left")
    logs = v.groupby(["Name", "Year"]).size().rename("logs").reset_index()
    films = films.merge(logs, on=["Name", "Year"], how="left").fillna({"logs": 0})
    films["series"] = films.types_en.fillna("").str.contains("series|episode|television program")
    return films


def director_card(r, v, meta):
    films = with_meta(r, v, meta)
    films = films[~films.series & (films.director_qids.fillna("") != "")]
    rows = []
    for _, f in films.iterrows():
        for qid, name in zip(f.director_qids.split("|"), f.directors.split("|")):
            rows.append({"qid": qid, "director": name, "film": f.Name, "year": int(f.Year),
                         "rating": float(f.Rating), "logs": int(f.logs)})
    d = pd.DataFrame(rows)
    overall = float(r.Rating.mean())
    g = d.groupby(["qid", "director"]).agg(n=("film", "size"), mean=("rating", "mean"), logs=("logs", "sum")).reset_index()

    def films_of(qid):
        s = d[d.qid == qid].sort_values(["rating", "year"], ascending=[False, True])
        return [{"film": x.film, "year": x.year, "rating": x.rating, "logs": x.logs} for x in s.itertuples()]

    top = g.sort_values(["n", "mean"], ascending=False).head(12)
    rated = g[g.n >= 3].sort_values("mean", ascending=False)
    pack = lambda t: [{"director": x.director, "qid": x.qid, "n": int(x.n), "mean": round(float(x.mean), 2),
                       "logs": int(x.logs), "films": films_of(x.qid)} for x in t.itertuples()]
    best = rated.iloc[0]
    fav = top.iloc[0]
    return {
        "coverage": int(films.shape[0]), "total": int(len(r)),
        "directors": int(g.shape[0]), "overall": round(overall, 2),
        "top": pack(top),
        "high": pack(rated.head(8)),
        "low": pack(rated.tail(5).iloc[::-1]),
        "eligible": int(len(rated)),
        "hint": f"{fav.director} {int(fav.n)}편, 평균 ★{fav['mean']:.2f}",
        "best": {"director": best.director, "n": int(best.n), "mean": round(float(best["mean"]), 2)},
    }


# ---------------------------------------------------------------- card 4: genres

# Wikidata genre labels are fine-grained ("neo-noir", "splatter film"); fold them
# into broad genres by keyword. A film can belong to several broad genres.
GENRE_RULES = [
    ("애니메이션", ["animated", "anime", "animation"]),
    ("다큐멘터리", ["documentary"]),
    ("코미디", ["comedy", "comedic", "parody", "satiric", "satire", "mockumentary"]),
    ("액션", ["action", "martial arts", "wuxia", "samurai", "swashbuckler", "kung fu"]),
    ("스릴러", ["thriller", "suspense"]),
    ("범죄", ["crime", "gangster", "heist", "noir", "caper", "yakuza", "mafia"]),
    ("SF", ["science fiction", "cyberpunk", "dystopian", "space opera", "post-apocalyptic", "time travel", "tech noir", "sci-fi"]),
    ("판타지", ["fantasy", "fairy tale", "sword and sorcery"]),
    ("호러", ["horror", "splatter", "slasher", "zombie", "vampire", "gore"]),
    ("로맨스", ["romance", "romantic"]),
    ("음악·뮤지컬", ["musical", "music", "concert", "dance film"]),
    ("전쟁", ["war film", "war drama", "anti-war"]),
    ("역사·전기", ["historical", "biographical", "biopic", "period"]),
    ("가족", ["family", "children's"]),
    ("미스터리", ["mystery", "detective", "whodunit"]),
    ("어드벤처", ["adventure"]),
    ("슈퍼히어로", ["superhero"]),
    ("성장", ["coming-of-age", "teen"]),
    ("LGBTQ", ["lgbt", "lesbian", "gay", "queer"]),
    ("드라마", ["drama"]),
]


def broad_genres(genres, types):
    # Film types such as "animated feature film" or "documentary film" also count as genres.
    labels = [x.lower().replace("live-action", "") for x in genres.split("|") if x]
    labels += [x.lower() for x in types.split("|") if "anim" in x.lower() or "documentary" in x.lower()]
    found = set()
    for lab in labels:
        for name, keys in GENRE_RULES:
            if name == "다큐멘터리" and "mockumentary" in lab:
                continue
            if any(k in lab for k in keys):
                found.add(name)
    return sorted(found)


def genre_card(r, v, meta):
    films = with_meta(r, v, meta)
    films["broad"] = [broad_genres(g or "", t or "") for g, t in zip(films.genres_en.fillna(""), films.types_en.fillna(""))]
    films["short"] = films.types_en.fillna("").str.contains("short film")
    has = films[films.broad.map(len) > 0]
    overall = float(r.Rating.mean())
    ex = has.explode("broad")
    g = ex.groupby("broad").agg(n=("Name", "size"), mean=("Rating", "mean")).reset_index()
    g = g[g.n >= 12].sort_values("n", ascending=False)
    rows = []
    for x in g.itertuples():
        s = ex[ex.broad == x.broad].sort_values(["Rating", "Year"], ascending=[False, False])
        rows.append({"genre": x.broad, "n": int(x.n), "mean": round(float(x.mean), 2),
                     "diff": round(float(x.mean) - overall, 2),
                     "share": round(x.n / len(has) * 100),
                     "top": [{"film": f.Name, "rating": float(f.Rating)} for f in s.head(3).itertuples()]})
    fav = max(rows, key=lambda x: x["mean"])
    least = min(rows, key=lambda x: x["mean"])
    most = rows[0]
    return {
        "coverage": int(len(has)), "total": int(len(r)), "overall": round(overall, 2),
        "genres": rows,
        "shorts": int(films.short.sum()),
        "hint": f"가장 후한 장르는 {fav['genre']}",
        "fav": fav["genre"], "least": least["genre"], "most": most["genre"],
    }


# ------------------------------------------------------------------- main

def main():
    r, v = load()
    data = {
        "meta": {
            "films": int(len(r)),
            "logs": int(len(v)),
            "mean": round(float(r.Rating.mean()), 2),
            "last_watch": str(v.W.max().date()),
        },
        "style": style_card(v),
        "revisions": revision_card(r, v),
    }
    meta_path = ROOT / "data" / "film_meta.csv"
    if meta_path.exists():
        meta = pd.read_csv(meta_path, dtype=str).fillna("")
        data["directors"] = director_card(r, v, meta)
        data["genres"] = genre_card(r, v, meta)
    OUT.parent.mkdir(exist_ok=True)
    page = TEMPLATE.read_text(encoding="utf-8").replace(
        "/*__DATA__*/", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
    OUT.write_text(page, encoding="utf-8")
    (ROOT / "cards" / "data.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
