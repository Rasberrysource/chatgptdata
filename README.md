# 1,185편의 기록

Letterboxd에 남긴 영화 평점 1,185편과 리뷰 996건으로 영화 취향을 분석한 개인 프로젝트입니다.
평점을 매기는 습관, 영화를 보는 장소와 시기, 리뷰 문체가 어떻게 변해 왔는지 살펴봤습니다.
감독과 장르 같은 영화 정보는 Wikidata에서 가져와 연결했습니다.

## 결과물

| 결과물 | 내용 | 파일 |
|---|---|---|
| 탐색 보고서 | 평점 습관, 연도별 평점 변화, 개봉 연대, 시청 플랫폼, 시청 리듬, N차 관람, 리뷰 문체 | [`reports/letterboxd-taste-report.md`](reports/letterboxd-taste-report.md) |
| 취향 카드 4장 | 문체 변화, 평점 번복, 최애 감독, 장르 지도 | [`cards/index.html`](cards/index.html) |
| 숨은 규칙 10개 | 후보 패턴 47개를 같은 기준으로 검정해서 끝까지 남은 패턴 | [`cards/patterns.html`](cards/patterns.html) |

보고서는 GitHub에서 바로 읽을 수 있습니다.
HTML 페이지 두 개는 GitHub 화면에서 소스 코드로만 보이므로, 저장소를 내려받은 뒤(**Code → Download ZIP**) 브라우저로 열어야 합니다.
설치나 서버는 필요 없습니다. 데이터가 페이지 안에 들어 있어서 인터넷이 끊겨도 열리고, 그때는 웹 폰트 대신 시스템 글꼴로 표시됩니다.

## 한눈에 보기

- **평점은 후하지만 5점은 아낍니다.** 평균은 3.63점인데 5점은 33편(2.8%)뿐입니다. 마지막 5점은 2022년 1월 29일에 본 Seven Samurai이고, 그 뒤로 346건을 기록하는 동안 5점은 한 번도 나오지 않았습니다.
- **평점이 점점 낮아졌습니다.** 시청 연도별 평균은 2016년 4.01점에서 2024년 3.36점으로 내려갔고, 4.5점 이상을 준 비율은 44%에서 4%로 떨어졌습니다.
- **극장 관람이 다시 늘었습니다.** 극장에서 본 기록의 비중은 2019년 60%에서 2020년 23%로 줄었다가, 2025년에는 85%까지 올라갔습니다.
- **리뷰 문체가 크게 세 번 바뀌었습니다.** 2021년에는 리뷰 10편 중 7편을 "1. 2. 3." 번호 목록으로 썼지만, 2026년에는 번호 목록을 한 번도 쓰지 않았습니다.
- **평점은 다시 볼 때만 바뀝니다.** 두 번 이상 기록한 영화 47편 중 평점이 바뀐 영화는 7편이고, 7편 모두 다시 본 날에 평점을 고쳤습니다.
- **가장 많이 본 감독은 크리스토퍼 놀런입니다.** 장편 13편 모두에 평점을 매겼고, 평균은 4.27점으로 전체 평균보다 0.64점 높습니다.
- **한국 영화에는 평점을 낮게 줍니다.** 한국이 제작에 참여한 영화 198편의 평균은 3.24점으로, 나머지 영화(3.79점)보다 0.5점 넘게 낮습니다. 영화의 유명세를 같게 맞춰도 차이가 남습니다.
- **'많이 볼수록 평점이 짜진다'는 가설은 근거를 찾지 못했습니다.** 보고서에서 세운 가설인데, 연도와 시청 플랫폼을 통제해서 검정해 보니 직전 7일 동안 본 영화 수에 따른 평점 차이가 우연과 구별되지 않았습니다.

## 파일 구성

```
reports/
  letterboxd-taste-report.md  탐색 보고서
cards/                        완성된 페이지와 수치
  index.html                  취향 카드 4장
  patterns.html               숨은 규칙 10개
  data.json                   카드에 쓴 수치
  patterns.json               후보 47개의 검정 결과 전체
analysis/                     분석 코드
  resolve_slugs.py            boxd.it 단축 링크를 Letterboxd 영화 슬러그로 변환
  enrich_wikidata.py          Wikidata에서 감독, 장르, 제작 국가, 상영 시간 수집
  enrich_extra.py             Wikidata에서 위키백과 언어판 수, 수상 기록, 속편 여부, 감독 성별 수집
  build_cards.py              카드 수치 계산, cards/index.html 생성
  patterns.py                 후보 패턴 47개 검정, cards/patterns.json 저장
  build_patterns.py           cards/patterns.html 생성
  cards_template.html         카드 페이지 틀
  patterns_template.html      숨은 규칙 페이지 틀
data/                         Wikidata에서 가져온 영화 정보
  film_meta.csv               감독, 장르, 제작 국가, 상영 시간
  film_extra.csv              위키백과 언어판 수, 수상 기록 수, 속편 여부
  director_gender.csv         감독 성별
  cache/                      슬러그 변환 결과와 Wikidata 조회 기록
```

## 다시 만들기

원본 Letterboxd 파일(`ratings.csv`, `reviews.csv`)은 개인 기록이라서 저장소에 올리지 않았습니다.
다시 계산하려면 Letterboxd 설정 화면의 데이터 내보내기(Export Your Data)로 받은 압축 파일에서 두 파일을 꺼내 `data/`에 넣습니다.
`.gitignore`가 두 파일을 제외하므로 실수로 커밋되지 않습니다.

Python 3이 필요합니다. `build_cards.py`와 `patterns.py`는 아래 패키지를 쓰고, 나머지 스크립트는 표준 라이브러리만 씁니다.

```
pip install pandas numpy scipy statsmodels
```

저장소 루트에서 순서대로 실행합니다.

```
python3 analysis/resolve_slugs.py                # data/cache/slugs.json
python3 analysis/enrich_wikidata.py --slug-only  # data/film_meta.csv
python3 analysis/enrich_extra.py                 # data/film_extra.csv, data/director_gender.csv
python3 analysis/build_cards.py                  # cards/index.html, cards/data.json
python3 analysis/patterns.py                     # cards/patterns.json
python3 analysis/build_patterns.py               # cards/patterns.html
```

- 1~3단계는 인터넷에 접속합니다. 결과 파일이 이미 저장소에 들어 있으므로, 새로 평점을 매긴 영화가 없다면 건너뛰어도 됩니다.
- `resolve_slugs.py`는 boxd.it 링크의 리디렉션 주소만 읽고, 영화 페이지는 받지 않습니다. 한 번 변환한 링크는 다시 조회하지 않습니다.
- `--slug-only`를 붙이면 Wikidata에 Letterboxd 영화 ID가 등록된 영화(1,185편 중 1,038편)만 연결합니다. 지금 결과물은 이 옵션으로 만들었습니다. 옵션을 빼면 나머지 영화를 영어 제목과 개봉 연도로 한 번 더 찾습니다.
- Wikidata 응답 원본(`data/cache/wikidata_rows.json`)은 저장소에 넣지 않았기 때문에, 새로 내려받은 저장소에서 2단계를 실행하면 모든 영화를 다시 조회합니다. Wikidata는 계속 수정되므로 감독과 장르 수치가 지금과 조금 달라질 수 있습니다.
- `build_patterns.py`는 `cards/patterns.json`만 읽기 때문에 원본 CSV 없이도 실행됩니다.

## 숨은 규칙을 고른 방법

`patterns.py`는 영화 속성(유명세, 수상 기록, 제작 국가, 상영 시간, 감독), 시청 습관, 평점 습관, 리뷰에 쓴 단어에 걸쳐 후보 패턴 47개를 먼저 정하고, 모두 같은 기준으로 검정합니다.

1. 평점이 해마다 낮아졌기 때문에, 같은 해에 본 영화끼리 비교하도록 연도를 통제합니다. 시청 습관과 리뷰 단어를 비교할 때는 시청 플랫폼과 재관람 여부도 함께 통제합니다.
2. 평점 차이는 OLS 회귀(HC3 표준오차)로 검정하고, .5점을 주는지처럼 예와 아니요로 나뉘는 결과는 로지스틱 회귀로 검정합니다.
3. 후보를 많이 검정하면 우연히 걸리는 패턴이 생기므로, p값 47개를 Benjamini-Hochberg 방법으로 한꺼번에 보정합니다. 보정한 값(q)이 0.05 미만인 패턴은 13개였습니다.
4. 영화의 유명세(위키백과 언어판 수)를 함께 넣어 다시 계산합니다. 효과의 방향이 바뀌거나 p가 0.05 이상이 된 3개를 빼고, 남은 10개를 페이지에 실었습니다.

모두 관찰 자료에서 나온 연관성이므로 원인과 결과를 뜻하지는 않습니다.

## 데이터 출처

- **평점과 리뷰**: 개인 Letterboxd 계정에서 내보낸 `ratings.csv`(영화 1,185편)와 `reviews.csv`(다이어리 기록 996건)입니다. 시청일은 2010년 7월부터 2026년 9월 16일까지입니다.
- **영화 정보**: 감독, 장르, 제작 국가, 상영 시간, 수상 기록, 위키백과 언어판 수, 감독 성별은 [Wikidata](https://www.wikidata.org/)(CC0)에서 가져왔습니다. Wikidata에 Letterboxd 영화 ID가 등록된 1,038편만 연결했습니다.
