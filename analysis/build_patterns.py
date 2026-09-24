"""Turn cards/patterns.json into the "hidden patterns" page (cards/patterns.html).

A pattern is shown only if it passed Benjamini-Hochberg at 5% AND kept the same
sign with p < 0.05 once the film's fame (log Wikipedia sitelinks) was added.
Copy for each pattern lives here; every number in it is read from the tests.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
TESTS = ROOT / "cards" / "patterns.json"
TEMPLATE = ROOT / "analysis" / "patterns_template.html"
OUT = ROOT / "cards" / "patterns.html"


def sgn(x, digits=2):
    return f"{x:+.{digits}f}"


COPY = {
    "fame": {
        "title": "유명한 영화일수록 후하다",
        "focus": "81+",
        "body": lambda t, c: f"영화 문서가 있는 위키백과 언어판 수를 영화의 유명세로 봤습니다. 10개 이하인 영화는 평균 ★{c[0]['mean']:.2f}, 81개 이상인 영화는 ★{c[-1]['mean']:.2f}입니다. 구간이 올라갈 때마다 평균이 빠짐없이 올라갑니다.",
        "effect_text": lambda t: f"언어판 수가 10배일 때 {sgn(t['effect'])}점",
        "chart_note": "위키백과 언어판 수",
        "examples": ["Forrest Gump ★5.0", "The Godfather ★5.0", "Toy Story ★5.0", "Spirited Away ★5.0", "Titanic ★4.5"],
        "examples_label": "언어판이 가장 많은 영화",
    },
    "award": {
        "title": "상을 받은 영화에 후하다, 유명세를 빼고도",
        "focus": "수상 기록 있음",
        "body": lambda t, c: f"Wikidata에 수상 기록이 하나라도 있는 영화는 평균 ★{c[1]['mean']:.2f}, 없는 영화는 ★{c[0]['mean']:.2f}입니다. 수상작은 대개 유명하기도 하지만, 유명세를 같게 맞춰도 {sgn(t['robust']['effect'])}점 차이가 남습니다.",
        "effect_text": lambda t: f"수상 기록이 있으면 {sgn(t['effect'])}점",
    },
    "korea": {
        "title": "한국 영화에 가장 짜다",
        "focus": "한국",
        "body": lambda t, c: f"한국이 제작에 참여한 영화 {c[1]['n']}편의 평균은 ★{c[1]['mean']:.2f}로, 나머지 영화(★{c[0]['mean']:.2f})보다 낮습니다. 4.5점 이상을 준 비율은 7%로 나머지(23%)의 3분의 1이고, 2.5점 이하 비율은 23%로 나머지(7%)의 3배입니다. 덜 알려진 한국 영화를 많이 본 영향이 크지만, 유명세를 같게 맞춰도 {sgn(t['robust']['effect'])}점 차이가 남습니다.",
        "effect_text": lambda t: f"한국 영화이면 {sgn(t['effect'])}점",
    },
    "known_director": {
        "title": "이미 아는 감독의 영화에 후하다",
        "focus": "아는 감독",
        "body": lambda t, c: f"다이어리 순서대로 봤을 때, 이전에 영화를 본 적 있는 감독의 작품은 평균 ★{c[1]['mean']:.2f}, 처음 만난 감독의 작품은 ★{c[0]['mean']:.2f}입니다. 좋아하는 감독을 다시 찾아보는 선택이 반영된 결과로 보입니다.",
        "effect_text": lambda t: f"아는 감독이면 {sgn(t['effect'])}점",
    },
    "runtime": {
        "title": "140분을 넘기면 평점이 뛴다",
        "focus": "141분+",
        "body": lambda t, c: f"장편만 놓고 보면 60분부터 140분까지는 평균이 ★{min(x['mean'] for x in c[:4]):.2f}~{max(x['mean'] for x in c[:4]):.2f}로 거의 같습니다. 141분 이상인 {c[-1]['n']}편에서만 ★{c[-1]['mean']:.2f}로 뛰어오릅니다. 길이가 늘수록 조금씩 오르는 게 아니라, 긴 대작에서 한 번에 오르는 모양입니다.",
        "effect_text": lambda t: f"30분 길어질 때 {sgn(t['effect'])}점",
        "chart_note": "상영 시간",
        "examples": ["The Godfather (175분) ★5.0", "The Godfather Part II (165분) ★5.0", "The Dark Knight (153분) ★5.0", "Inglourious Basterds (153분) ★5.0", "Mulholland Drive (147분) ★5.0"],
        "examples_label": "141분 이상에서 5점을 준 영화",
    },
    "word:눈물": {
        "title": "리뷰에 '눈물'을 쓰면 평점이 높다",
        "focus": "있음",
        "body": lambda t, c: f"'눈물'이 들어간 리뷰 {c[1]['n']}건의 평균은 ★{c[1]['mean']:.2f}로, 나머지 리뷰(★{c[0]['mean']:.2f})보다 높습니다. 울었다고 적은 영화에는 점수도 후하게 줬다는 뜻입니다.",
        "effect_text": lambda t: f"'눈물'이 있으면 {sgn(t['effect'])}점",
        "quotes": [("Carol", 4.5, "스탭롤 보는데 눈물이 핑 돌더라"),
                   ("Sinners", 4.5, "특히 ‘그 장면’ 아주 좋아서 눈물이 날 지경이었다."),
                   ("The Whale", 4.0, "역겨운 인간을 감추지도 않는데, 눈물은 왜 이렇게 나올까.")],
    },
    "rerelease": {
        "title": "극장에서 다시 만난 옛 영화에 후하다",
        "focus": "10년 이상 된 영화",
        "body": lambda t, c: f"극장에서 처음 본 영화 중 개봉 10년이 넘은 {c[1]['n']}편의 평균은 ★{c[1]['mean']:.2f}, 신작 {c[0]['n']}편은 ★{c[0]['mean']:.2f}입니다. 재개봉관에서 본 고전이 신작보다 더 좋은 평가를 받았습니다.",
        "effect_text": lambda t: f"10년 이상 된 영화이면 {sgn(t['effect'])}점",
        "examples": ["Eternal Sunshine of the Spotless Mind ★5.0", "Children of Men ★5.0", "Memento ★4.5", "Blade Runner ★4.5", "Hedwig and the Angry Inch ★4.5"],
        "examples_label": "극장에서 본 옛 영화",
    },
    "word:차라리": {
        "title": "'차라리'가 나오면 평점이 떨어진다",
        "focus": "있음",
        "body": lambda t, c: f"'차라리'가 들어간 리뷰 {c[1]['n']}건의 평균은 ★{c[1]['mean']:.2f}입니다. 나머지 리뷰(★{c[0]['mean']:.2f})보다 0.6점 넘게 낮습니다. '차라리 이렇게 만들지'라고 대안을 떠올린 영화에는 점수가 짰습니다.",
        "effect_text": lambda t: f"'차라리'가 있으면 {sgn(t['effect'])}점",
        "quotes": [("King Cobra", 2.0, "차라리 다큐멘터리로 만들었다면 어땠을까."),
                   ("Twittering Birds Never Fly: The Clouds Gather", 2.0, "이럴 거면 그냥 차라리 8부작 시리즈물로 만드시지 그랬나요."),
                   ("Tetris", 3.5, "첩보전을 할 거면 차라리 팅커 테일러 솔져 스파이처럼 나가지 그랬나.")],
    },
    "word:메시지": {
        "title": "'메시지'를 이야기할 때는 후하다",
        "focus": "있음",
        "body": lambda t, c: f"'메시지'가 들어간 리뷰 {c[1]['n']}건의 평균은 ★{c[1]['mean']:.2f}, 나머지는 ★{c[0]['mean']:.2f}입니다. 영화가 던지는 메시지를 짚은 리뷰에서 점수가 높았습니다. '문자 메시지'를 뜻한 2건을 빼고 다시 계산해도 +0.33점(p=0.008)으로 같습니다.",
        "effect_text": lambda t: f"'메시지'가 있으면 {sgn(t['effect'])}점",
        "quotes": [("The Last Duel", 4.5, "리들리 스콧은 우리에게 중세인의 이야기를 통해 현대인에게 메시지를 던지는 모습을 자주 보여주었다."),
                   ("The Big Short", 4.5, "용케 안 빠지고 잔잔하게 메시지를 전달한다.")],
    },
    "japan": {
        "title": "일본 영화에는 오히려 후하다",
        "focus": "일본",
        "body": lambda t, c: f"일본이 제작에 참여한 영화 {c[1]['n']}편의 평균은 ★{c[1]['mean']:.2f}로, 나머지(★{c[0]['mean']:.2f})보다 높습니다. 한국 영화와 반대로, 유명세를 같게 맞추면 차이가 {sgn(t['robust']['effect'])}점으로 오히려 커집니다.",
        "effect_text": lambda t: f"일본 영화이면 {sgn(t['effect'])}점",
        "examples": ["Spirited Away ★5.0", "Seven Samurai ★5.0", "Love Letter ★4.5", "Millennium Actress ★4.5"],
        "examples_label": "일본 영화 중 높게 준 작품",
    },
}

DROPPED_LABEL = {
    "coprod": "여러 나라가 함께 만든 영화",
    "us_only": "미국 단독 제작 영화",
    "release_gap": "개봉 2~5년 뒤에 본 영화",
}
NULL_LABEL = {
    "fatigue": "직전 7일 동안 본 영화 1편당 (몰아보기 피로)",
    "carryover": "직전에 본 영화의 평점 1점당",
    "weekend": "주말에 본 영화",
    "december": "12월에 본 영화",
    "female_dir": "여성 감독이 참여한 영화",
    "sequel": "속편",
    "short": "단편",
    "comeback": "2주 이상 쉬고 처음 본 영화",
    "multi_day": "하루에 여러 편 본 날",
    "half_star": "해가 지날수록 .5점을 더 자주 주는지",
}


def main():
    data = json.loads(TESTS.read_text(encoding="utf-8"))
    tests = {t["name"]: t for t in data["tests"]}
    sig = [t for t in data["tests"] if t["significant"]]

    def robust_ok(t):
        rb = t.get("robust")
        return rb is None or (rb["p"] < 0.05 and (rb["effect"] > 0) == (t["effect"] > 0))

    picks = sorted([t for t in sig if robust_ok(t)], key=lambda t: t["q"])
    dropped = [t for t in sig if not robust_ok(t)]
    assert set(t["name"] for t in picks) == set(COPY), sorted(t["name"] for t in picks)

    out = []
    for rank, t in enumerate(picks, 1):
        c = COPY[t["name"]]
        rb = t.get("robust")
        out.append({
            "rank": rank, "name": t["name"], "family": t["family"], "title": c["title"],
            "body": c["body"](t, t["chart"]), "effect_text": c["effect_text"](t),
            "effect": t["effect"], "ci": t["ci"], "n": t["n"], "unit": t["unit"], "q": t["q"], "p": t["p"],
            "robust": rb, "chart": t["chart"], "focus": c["focus"], "chart_note": c.get("chart_note"),
            "examples": c.get("examples"), "examples_label": c.get("examples_label"),
            "quotes": [{"film": f, "rating": r, "text": q} for f, r, q in c.get("quotes", [])],
        })
    nulls = [{"label": NULL_LABEL[n], "effect": tests[n]["effect"], "q": tests[n]["q"], "kind": tests[n]["kind"]}
             for n in NULL_LABEL if n in tests and not tests[n]["significant"]]
    page = {
        "n_tests": data["n_tests"], "n_sig": len(sig), "n_picks": len(picks),
        "patterns": out,
        "dropped": [{"label": DROPPED_LABEL[t["name"]], "effect": t["effect"], "robust": t["robust"]["effect"],
                     "robust_p": t["robust"]["p"], "q": t["q"]} for t in dropped],
        "nulls": nulls,
        "word_tests": sum(1 for t in data["tests"] if t["name"].startswith("word:")),
    }
    cards = (ROOT / "analysis" / "cards_template.html").read_text(encoding="utf-8")
    base_css = cards[cards.index("<style>") + len("<style>"):cards.index("</style>")]
    html = TEMPLATE.read_text(encoding="utf-8").replace("/*__BASE_CSS__*/", base_css).replace(
        "/*__DATA__*/", json.dumps(page, ensure_ascii=False).replace("</", "<\\/"))
    OUT.write_text(html, encoding="utf-8")
    print("wrote", OUT, len(picks), "patterns;", [t["name"] for t in picks])


if __name__ == "__main__":
    main()
