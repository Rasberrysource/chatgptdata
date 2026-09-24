"""Screen candidate taste patterns and keep only the ones that survive FDR control.

Every candidate is tested the same way:
- rating outcomes use OLS with robust (HC3) standard errors and fixed effects for
  the year the film was logged, so the long-run drift in ratings (see the report)
  cannot masquerade as a pattern;
- binary outcomes use logistic regression with the same year control;
- all p-values go through one Benjamini-Hochberg correction together.
Output: cards/patterns.json (every test, with q-values) used by the page.
"""
import json
import pathlib
import re

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from statsmodels.stats.multitest import multipletests

from build_cards import load, with_meta, broad_genres

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "cards" / "patterns.json"
RNG = np.random.default_rng(7)


# ------------------------------------------------------------------ data

def films_table():
    r, v = load()
    meta = pd.read_csv(ROOT / "data" / "film_meta.csv", dtype=str).fillna("")
    extra = pd.read_csv(ROOT / "data" / "film_extra.csv", dtype={"qid": str})
    gender = pd.read_csv(ROOT / "data" / "director_gender.csv")
    f = with_meta(r, v, meta).merge(extra, on="qid", how="left")
    f["matched"] = f.qid.fillna("") != ""
    first = v.dropna(subset=["W"]).sort_values("W").groupby(["Name", "Year"]).W.first().rename("first_watch")
    f = f.merge(first.reset_index(), on=["Name", "Year"], how="left")
    # Films rated without a diary entry were entered in bulk in 2018; they get their own period.
    # Years before 2016 hold one to eight logs each; pool them so no fixed effect rests on a single film.
    f["period"] = np.where(f.first_watch.notna(), f.first_watch.dt.year.clip(lower=2016).astype("Int64").astype(str), "bulk")
    f["runtime"] = pd.to_numeric(f.runtime, errors="coerce")
    f["short"] = f.types_en.fillna("").str.contains("short film") | (f.runtime < 40)
    f["countries"] = f.countries.fillna("")
    g = dict(zip(gender.director_qid, gender.gender))
    def dir_gender(qids):
        gs = {g.get(q) for q in str(qids).split("|") if q}
        if not gs or gs == {None}:
            return None
        return "female" if "female" in gs else ("male" if gs <= {"male"} else "other")
    f["dir_gender"] = f.director_qids.fillna("").map(dir_gender)
    f["broad"] = [broad_genres(a or "", b or "") for a, b in zip(f.genres_en.fillna(""), f.types_en.fillna(""))]
    return r, v, f


def logs_table(v, f):
    d = v.dropna(subset=["W"]).reset_index().rename(columns={"index": "row"})
    d = d.sort_values(["W", "row"]).reset_index(drop=True)
    d["year"] = d.W.dt.year.clip(lower=2016).astype(str)
    tags = d.Tags.fillna("")
    d["platform"] = np.select(
        [tags.str.contains("cinema|preview|bifan|biaf|festival"), tags.str.contains("netflix"),
         tags.str.contains("watchaplay"), tags.str.contains("youtube")],
        ["cinema", "netflix", "watcha", "youtube"], "other")
    d["rewatch"] = (d.Rewatch == "Yes").astype(int)
    d["lag"] = d.W.dt.year - d.Year
    # films logged in the 7 days before this one (same-day logs excluded)
    dates = d.W.values.astype("datetime64[D]")
    d["prev7"] = [int(((dates >= x - np.timedelta64(7, "D")) & (dates < x)).sum()) for x in dates]
    gap = d.W.diff().dt.days
    d["gap"] = gap
    d["prev_rating"] = d.Rating.shift(1)
    per_day = d.groupby("W").W.transform("size")
    d["multi_day"] = (per_day > 1).astype(int)
    d["weekend"] = d.W.dt.dayofweek.isin([5, 6]).astype(int)
    d["december"] = (d.W.dt.month == 12).astype(int)
    body = d.text.str.replace(r"\n?@[^\n]*$", "", regex=True)
    d["body"] = body
    d = d.merge(f[["Name", "Year", "sitelinks", "runtime", "short", "countries"]], on=["Name", "Year"], how="left")
    d["log_links"] = np.log10(d.sitelinks.clip(lower=1))
    return d


# ---------------------------------------------------------------- testing

TESTS = []


def fit(df, formula):
    df = df.dropna(subset=[c for c in re.findall(r"[A-Za-z_][A-Za-z_0-9]*", formula) if c in df.columns])
    return smf.ols(formula, data=df).fit(cov_type="HC3")


def ols(name, family, df, formula, term, unit, describe, extra=None):
    m = fit(df, formula)
    est, (lo, hi), p = m.params[term], m.conf_int().loc[term], m.pvalues[term]
    rec = {"name": name, "family": family, "kind": "ols", "n": int(m.nobs), "unit": unit,
           "effect": float(est), "ci": [float(lo), float(hi)], "p": float(p),
           "describe": describe, **(extra or {})}
    # Robustness: does the pattern survive once the film's fame is held fixed too?
    if term != "log_links" and "log_links" in df.columns:
        mr = fit(df, formula + " + log_links")
        rec["robust"] = {"n": int(mr.nobs), "effect": float(mr.params[term]),
                         "ci": [float(x) for x in mr.conf_int().loc[term]], "p": float(mr.pvalues[term])}
    TESTS.append(rec)


def logit(name, family, df, formula, term, unit, describe, extra=None):
    df = df.dropna()
    m = smf.logit(formula, data=df).fit(disp=False, cov_type="HC1")
    est, (lo, hi), p = m.params[term], m.conf_int().loc[term], m.pvalues[term]
    TESTS.append({"name": name, "family": family, "kind": "logit", "n": int(m.nobs), "unit": unit,
                  "effect": float(np.exp(est)), "ci": [float(np.exp(lo)), float(np.exp(hi))], "p": float(p),
                  "describe": describe, **(extra or {})})


def group_means(df, col, groups, value="Rating"):
    return [{"label": lab, "n": int((df[col] == key).sum()), "mean": round(float(df.loc[df[col] == key, value].mean()), 2)}
            for key, lab in groups]


def run(r, v, f, d):
    fm = f[f.matched & ~f.series].copy()

    # A. film attributes, film level, period fixed effects
    fm["log_links"] = np.log10(fm.sitelinks.clip(lower=1))
    bins = pd.cut(fm.sitelinks, [0, 10, 25, 50, 80, 1000], labels=["≤10", "11–25", "26–50", "51–80", "81+"])
    ols("fame", "영화", fm, "Rating ~ log_links + C(period)", "log_links", "영화",
        "위키백과 언어판 수가 10배일 때 평점 차이",
        {"chart": [{"label": str(b), "n": int((bins == b).sum()), "mean": round(float(fm.Rating[bins == b].mean()), 2)} for b in bins.cat.categories]})

    feat = fm[(fm.runtime >= 60) & (fm.runtime <= 240)].copy()
    feat["rt30"] = feat.runtime / 30
    rb = pd.cut(feat.runtime, [59, 90, 105, 120, 140, 240], labels=["60–90분", "91–105분", "106–120분", "121–140분", "141분+"])
    ols("runtime", "영화", feat, "Rating ~ rt30 + C(period)", "rt30", "장편 영화",
        "상영 시간이 30분 길어질 때 평점 차이",
        {"chart": [{"label": str(b), "n": int((rb == b).sum()), "mean": round(float(feat.Rating[rb == b].mean()), 2)} for b in rb.cat.categories]})

    fm["seq"] = fm.sequel.fillna(0).astype(int)
    ols("sequel", "영화", fm, "Rating ~ seq + C(period)", "seq", "영화", "속편과 속편이 아닌 영화의 평점 차이",
        {"chart": group_means(fm, "seq", [(0, "속편 아님"), (1, "속편")])})

    fm["award"] = (fm.awards.fillna(0) > 0).astype(int)
    ols("award", "영화", fm, "Rating ~ award + C(period)", "award", "영화", "수상 기록이 있는 영화의 평점 차이",
        {"chart": group_means(fm, "award", [(0, "수상 기록 없음"), (1, "수상 기록 있음")])})

    fm["korea"] = fm.countries.str.contains("대한민국").astype(int)
    ols("korea", "영화", fm, "Rating ~ korea + C(period)", "korea", "영화", "한국 제작 영화의 평점 차이",
        {"chart": group_means(fm, "korea", [(0, "한국 외"), (1, "한국")])})
    fm["japan"] = fm.countries.str.contains("일본").astype(int)
    ols("japan", "영화", fm, "Rating ~ japan + C(period)", "japan", "영화", "일본 제작 영화의 평점 차이",
        {"chart": group_means(fm, "japan", [(0, "일본 외"), (1, "일본")])})
    fm["us_only"] = (fm.countries == "미국").astype(int)
    ols("us_only", "영화", fm, "Rating ~ us_only + C(period)", "us_only", "영화", "미국 단독 제작 영화의 평점 차이",
        {"chart": group_means(fm, "us_only", [(0, "그 밖"), (1, "미국 단독")])})
    fm["coprod"] = (fm.countries.str.count(r"\|") >= 1).astype(int)
    ols("coprod", "영화", fm, "Rating ~ coprod + C(period)", "coprod", "영화", "여러 나라가 함께 만든 영화의 평점 차이",
        {"chart": group_means(fm, "coprod", [(0, "한 나라"), (1, "공동 제작")])})

    fg = fm[fm.dir_gender.isin(["female", "male"])].copy()
    fg["female"] = (fg.dir_gender == "female").astype(int)
    ols("female_dir", "영화", fg, "Rating ~ female + C(period)", "female", "영화", "여성 감독 영화의 평점 차이",
        {"chart": group_means(fg, "female", [(0, "남성 감독"), (1, "여성 감독 참여")])})

    fm["short_i"] = fm.short.astype(int)
    ols("short", "영화", fm, "Rating ~ short_i + C(period)", "short_i", "영화", "단편의 평점 차이",
        {"chart": group_means(fm, "short_i", [(0, "장편"), (1, "단편")])})

    # already-known director: seen another film by this director before this one
    dd = fm.dropna(subset=["first_watch"]).sort_values("first_watch")
    seen, known = set(fm[fm.first_watch.isna()].director_qids.fillna("").str.split("|").explode()) - {""}, []
    for q in dd.director_qids.fillna(""):
        ds = [x for x in q.split("|") if x]
        known.append(int(bool(ds) and any(x in seen for x in ds)))
        seen.update(ds)
    dd["known_dir"] = known
    ols("known_director", "영화", dd[dd.director_qids.fillna("") != ""], "Rating ~ known_dir + C(period)", "known_dir", "처음 본 영화",
        "이미 영화를 본 적 있는 감독의 신작(내 기준)에 준 평점 차이",
        {"chart": group_means(dd, "known_dir", [(0, "처음 만난 감독"), (1, "아는 감독")])})

    # B. viewing behaviour, diary level, year + platform fixed effects
    ctrl = "C(year) + C(platform) + rewatch"
    ols("fatigue", "시청 습관", d, f"Rating ~ prev7 + {ctrl}", "prev7", "다이어리",
        "직전 7일 동안 본 영화가 1편 늘 때 평점 차이",
        {"chart": [{"label": lab, "n": int(m.sum()), "mean": round(float(d.Rating[m].mean()), 2)}
                   for lab, m in [("0편", d.prev7 == 0), ("1–2편", d.prev7.between(1, 2)), ("3–5편", d.prev7.between(3, 5)), ("6편+", d.prev7 >= 6)]]})
    ols("carryover", "시청 습관", d, f"Rating ~ prev_rating + {ctrl}", "prev_rating", "다이어리",
        "직전에 본 영화의 평점이 1점 높을 때 다음 영화의 평점 차이",
        {"chart": [{"label": f"직전 {lab}", "n": int(m.sum()), "mean": round(float(d.Rating[m].mean()), 2)}
                   for lab, m in [("2.5 이하", d.prev_rating <= 2.5), ("3–3.5", d.prev_rating.between(3, 3.5)), ("4", d.prev_rating == 4), ("4.5 이상", d.prev_rating >= 4.5)]]})
    d["comeback"] = (d.gap >= 14).astype(int)
    ols("comeback", "시청 습관", d.dropna(subset=["gap"]), f"Rating ~ comeback + {ctrl}", "comeback", "다이어리",
        "2주 이상 쉬고 처음 본 영화의 평점 차이",
        {"chart": group_means(d.dropna(subset=["gap"]), "comeback", [(0, "평소"), (1, "2주 이상 쉰 뒤")])})
    ols("multi_day", "시청 습관", d, f"Rating ~ multi_day + {ctrl}", "multi_day", "다이어리",
        "하루에 두 편 이상 본 날의 평점 차이",
        {"chart": group_means(d, "multi_day", [(0, "하루 한 편"), (1, "하루 여러 편")])})
    ols("weekend", "시청 습관", d, f"Rating ~ weekend + {ctrl}", "weekend", "다이어리", "주말에 본 영화의 평점 차이",
        {"chart": group_means(d, "weekend", [(0, "평일"), (1, "주말")])})
    ols("december", "시청 습관", d, f"Rating ~ december + {ctrl}", "december", "다이어리", "12월에 본 영화의 평점 차이",
        {"chart": group_means(d, "december", [(0, "1–11월"), (1, "12월")])})

    fv = d[d.rewatch == 0].dropna(subset=["lag"]).copy()
    fv["mid_age"] = fv.lag.between(2, 5).astype(int)
    ols("release_gap", "시청 습관", fv, "Rating ~ mid_age + C(year) + C(platform)", "mid_age", "첫 관람",
        "개봉 2~5년 뒤에 본 영화의 평점 차이",
        {"chart": [{"label": lab, "n": int(m.sum()), "mean": round(float(fv.Rating[m].mean()), 2)}
                   for lab, m in [("개봉 연도", fv.lag <= 0), ("1년 뒤", fv.lag == 1), ("2–5년 뒤", fv.lag.between(2, 5)), ("6–15년 뒤", fv.lag.between(6, 15)), ("16년 이상", fv.lag >= 16)]]})
    cin = fv[fv.platform == "cinema"].copy()
    cin["old"] = (cin.lag >= 10).astype(int)
    ols("rerelease", "시청 습관", cin, "Rating ~ old + C(year)", "old", "극장 첫 관람",
        "극장에서 개봉 10년 이상 된 영화를 봤을 때의 평점 차이",
        {"chart": group_means(cin, "old", [(0, "신작"), (1, "10년 이상 된 영화")])})

    # C. rating habits
    d["half"] = (d.Rating % 1 == 0.5).astype(int)
    d["t"] = d.W.dt.year - 2016
    logit("half_star", "평점 습관", d[["half", "t", "platform"]].assign(platform=d.platform), "half ~ t + C(platform)", "t", "다이어리",
          "해가 지날 때마다 .5점을 줄 오즈 배율",
          {"chart": [{"label": str(y), "n": int((d.W.dt.year == y).sum()), "mean": round(float(d.half[d.W.dt.year == y].mean() * 100))} for y in range(2016, 2027)]})
    early, late = d[d.W.dt.year.between(2016, 2019)].Rating, d[d.W.dt.year.between(2022, 2026)].Rating
    from scipy.stats import levene
    stat, p = levene(early, late, center="median")
    TESTS.append({"name": "spread", "family": "평점 습관", "kind": "levene", "n": int(len(early) + len(late)), "unit": "다이어리",
                  "effect": float(late.std() - early.std()), "ci": None, "p": float(p),
                  "describe": "2022–2026년과 2016–2019년의 평점 표준편차 차이",
                  "chart": [{"label": "2016–2019", "n": int(len(early)), "mean": round(float(early.std()), 2)},
                            {"label": "2022–2026", "n": int(len(late)), "mean": round(float(late.std()), 2)}]})

    # D. review text markers: each term is its own test inside the same correction
    terms = ["음악", "연기", "연출", "각본", "결말", "스토리", "배우", "감독", "영상미", "근데", "아쉽", "지루", "눈물",
             "ㅋㅋ", "그나저나", "솔직히", "역시", "굳이", "차라리", "원작", "실화", "반전", "캐릭터", "액션", "분위기",
             "메시지", "사운드", "노래", "《", "?", "!", "…"]
    for term in terms:
        d["has"] = d.body.str.contains(re.escape(term)).astype(int)
        if d.has.sum() < 15:
            continue
        ols(f"word:{term}", "리뷰 말투", d, f"Rating ~ has + {ctrl}", "has", "리뷰",
            f"리뷰에 '{term}'이(가) 들어갈 때 평점 차이",
            {"term": term, "chart": group_means(d, "has", [(0, "없음"), (1, "있음")])})


def main():
    r, v, f = films_table()
    d = logs_table(v, f)
    run(r, v, f, d)
    ps = [t["p"] for t in TESTS]
    rej, q, _, _ = multipletests(ps, alpha=0.05, method="fdr_bh")
    for t, qq, ok in zip(TESTS, q, rej):
        t["q"] = float(qq)
        t["significant"] = bool(ok)
    OUT.write_text(json.dumps({"tests": TESTS, "n_tests": len(TESTS)}, ensure_ascii=False, indent=1), encoding="utf-8")
    df = pd.DataFrame(TESTS)[["name", "family", "n", "effect", "ci", "p", "q", "significant"]]
    pd.set_option("display.width", 200)
    print(df.sort_values("q").to_string())


if __name__ == "__main__":
    main()
