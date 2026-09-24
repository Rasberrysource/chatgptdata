# Oscar Race Lab — 조사 계획 및 데이터 설계

> 범위: 제72회(2000) ~ 제98회(2026) 아카데미 시상식 **작품상** 레이스, 총 27개 시즌.
> 이 문서는 구현 전에 작성한 설계서이며, 실제 수집 과정에서 확인된 사항을 반영해 갱신했다.

---

## 1. 조사할 시상식과 각 상의 의미

같은 “전초전”이라도 **무엇에 주는 상인지**, **누가 투표하는지**가 다르다. 사이트는 이 차이를 숨기지 않고 모든 표·차트에 상의 성격을 함께 표시한다.

| ID | 시상식 / 부문 | 실제로 시상하는 대상 | 투표 주체 (대략) | 작품상과의 관계 |
|---|---|---|---|---|
| `oscar_bp` | Academy Awards — Best Picture | 작품 (프로듀서 수상) | AMPAS 전 회원. 2010년(82회)부터 작품상은 선호투표(순위식) | **목표 변수** |
| `pga` | PGA — Darryl F. Zanuck Award (Theatrical Motion Picture) | 작품 (프로듀서) | 미국 프로듀서 조합원. 2010년부터 후보 10편·선호투표 | 작품상 대응(직접) |
| `dga` | DGA — Outstanding Directorial Achievement in Feature Film | **감독 개인** → 해당 영화로 연결 | 미국 감독 조합원(TV 감독 포함) | 작품상 대응(간접: 감독상 성격) |
| `sag_ensemble` | SAG (2026년부터 *Actor Awards*) — Outstanding Performance by a Cast | **출연진 전체** | SAG-AFTRA 회원 | 작품상 대응(간접: 앙상블 연기) |
| `bafta_film` | BAFTA — Best Film | 작품 | 영국 아카데미 회원(국제 회원 포함). **영국 개봉일 기준** 자격 | 작품상 대응(직접) |
| `gg_drama` / `gg_musical_comedy` | Golden Globes — Best Motion Picture (Drama / Musical or Comedy) | 작품, **장르별 2개 부문** | 2023년까지 HFPA(약 80~100명), 2024년부터 재편된 국제 기자단(약 300명) | 작품상 대응(직접, 단 수상작이 매년 2편) |
| `cc_picture` | Critics Choice — Best Picture | 작품 | Critics Choice Association(방송·온라인 평론가) | 작품상 대응(직접) |
| `wga_original` / `wga_adapted` | WGA — Original / Adapted Screenplay | **각본** | 미국 작가조합원. **조합 관할 각본만 자격** | **별도 지표(각본 지표)** — 전초전 합계에 넣지 않음 |

원칙:
- **작품상 대응 전초전(“핵심 6개 기관”)** = PGA, DGA, SAG 앙상블, BAFTA, 골든글로브(2개 부문을 한 기관으로 묶음), Critics Choice.
- WGA는 각본 지표로만 따로 표시한다. 전초전 수상 합계·수렴도·선두 계산에 절대 섞지 않는다.
- DGA/SAG는 작품이 아니라 감독·출연진에게 주는 상이므로, 사이트는 “DGA 수상작”이 아니라 “DGA 수상 감독의 영화”처럼 성격을 명시한다.

## 2. 2000~2026을 시즌 단위로 정렬하는 방법

- **시즌 ID = 아카데미 시상식이 열린 해** (예: 시즌 2020 = 제92회, 2019년 영화).
- 각 전초전 시상식은 **대상 작품 연도(film year)** 로 시즌에 매핑한다: `season = film_year + 1`.
  위키백과·공식 자료 모두 전초전을 “대상 작품 연도”로 표기하므로 이 규칙으로 일관되게 정렬된다(제n회 번호와의 대응은 스크립트가 자동 점검).
- 시즌마다 모든 시상식의 **개최일(수상자 발표일)** 을 저장해 시간순 타임라인을 만든다. 아카데미 **후보 발표일**도 타임라인 이벤트로 넣는다.
- 파생 플래그: `before_oscar_nominations`(오스카 후보 발표 전 개최), `after_oscars`(오스카 이후 개최 — 전초전이 아님).

알려진 예외(데이터에 주석으로 기록):
| 시즌 | 내용 |
|---|---|
| 2000 | BAFTA(제53회)가 오스카(3/26) **이후**인 4/9에 개최 — 당시엔 전초전이 아니었음 |
| 2008 | 골든글로브 제65회: 작가 파업으로 시상식 대신 기자회견으로 발표 |
| 2017 | Critics Choice 제22회가 2016년 12월 11일 개최(유례없이 이른 시점) |
| 2021 | 코로나19: 오스카 자격 기간이 2021년 2월 28일까지 연장, 모든 시상식이 늦춰짐(오스카 4/25) |
| 2021 | BAFTA 제74회 이틀(4/10–11) 개최 — 작품상 발표일로 기록 |
| 2022 | 골든글로브 제79회: 방송 없이 비공개 발표(NBC 보이콧) |
| 2025 | Critics Choice 제30회: LA 산불로 2025년 2월 7일로 연기 |
| 2026 | SAG Awards가 *Actor Awards*로 명칭 변경(제32회) |

## 3. 데이터 스키마

**원자료(사실) 레이어**와 **분석(해석) 레이어**를 파일 단위로 분리한다.

### 3-1. 사실 레이어 (`data/build/*.json`)

```
seasons        { season, oscar_ordinal, film_year, oscar_date, oscar_nominations_date,
                 bp_nominee_count, notes[] }
award_bodies   { id, name, short, kind: target|bp_precursor|screenplay_indicator,
                 honors: film|director|cast|screenplay, voters, notes[] }
categories     { id, body_id, name, per_season_winners }
ceremonies     { id, body_id, season, film_year, name, ordinal, date, date_note,
                 before_oscar_nominations, after_oscars, wiki_page, source_id }
films          { id, title, wiki_title, wikidata_qid, film_year,
                 aliases[{title, seen_in:[category…]}] }
nominations    { id, season, category, ceremony_id, film_id, result: won|nominated,
                 tie, shown_title, people, source_ids[], verification{status, checks[]} }
eligibility    { film_id, season, category, status: ineligible, rule, evidence, source_ids[] }
oscar_film_totals { season, film_id, total_nominations, basis }
sources        { id, kind: official|secondary, publisher, title, url, permalink, revid, retrieved_at }
issues         { id, severity, scope, text }
```

- `film_id`: 위키백과 문서에 연결된 **Wikidata QID**(예: `Q40531`)를 기본 키로 사용. 동명 영화·리메이크를 문서 단위로 구분할 수 있다.
- `result`는 `won`/`nominated` 두 값만 사실로 저장한다. “후보에 없음”은 저장하지 않고, 해당 시상식의 후보 목록 전체가 확인된 경우에만 분석 레이어에서 `not_nominated`로 **도출**한다.
- 자격 없음(`ineligible`)은 **문서화된 규칙과 증거가 있을 때만** 기록한다(예: 골든글로브 외국어영화상 후보 → 2023년까지 작품상 부문 자격 없음).

### 3-2. 분석 레이어 (`data/build/analysis.json`, 사이트 JS에서도 동일 규칙 계산)

- `status` 매트릭스: 시즌 × 영화 × 부문 → `W`(수상) / `N`(후보) / `–`(후보 아님, 목록 완비) / `I`(자격 없음, 근거 있음) / `?`(불명)
- `precursor_wins`: 핵심 6개 기관 중 수상한 기관 수(0~6, 골든글로브는 두 부문 중 하나라도 수상하면 1).
- `timeline`: 개최일 순으로 누적한 기관별 수상 수. “선두”는 **그 시점까지 누적 수상 수가 가장 많은 영화(동률이면 공동)**. 확률·배당·여론 수치는 만들지 않는다.
- 해석 라벨(규칙과 임계값을 함께 저장·표시, 사이트에서 임계값 조정 가능):
  - 수렴도 = 최다 수상 영화의 기관 수(6이면 완전 수렴)
  - “전초전 최다 수상작의 작품상 실패”, “약한 전초전 성적의 작품상 수상(≤1개 기관)”, “초반 선두(첫 2개 전초전 기준)와 최종 수상작 불일치” 등

## 4. 신뢰할 수 있는 주요 출처

| 우선순위 | 출처 | 용도 | 접근성(이 환경에서 확인) |
|---|---|---|---|
| 공식 | oscars.org / Academy Awards Database | 작품상 후보·수상 | 403 차단 → 자동 검증 불가 |
| 공식 | producersguild.org 수상 연혁 | PGA | 접속 가능 |
| 공식 | dga.org Awards History | DGA | 접속 가능 |
| 공식 | actorawards.org(구 sagawards.org) | SAG 앙상블 | 접속 가능 |
| 공식 | awards.bafta.org | BAFTA | 403 차단 |
| 공식 | goldenglobes.com | 골든글로브 | 접속 가능 |
| 공식 | criticschoice.com | Critics Choice | 접속 가능 |
| 공식 | wga.org / awards.wga.org | WGA | 접속 가능 |
| 2차(구조화 기본) | 영어 위키백과 부문별 수상 목록 + 회차별 문서 | 27개 시즌 전 부문 후보·수상, 개최일 | API로 **리비전 고정(permalink)** 스냅샷 저장 |
| 2차(식별) | Wikidata | 영화 ID(QID), 문서 리디렉션 해소 | API |

방법: 위키백과 목록을 **일관된 기본 소스**로 전 범위를 구조화하고(각 표는 공식 보도자료·주요 매체를 각주로 인용), (a) 같은 위키백과의 회차별 문서와 교차 대조해 파싱 오류를 잡고, (b) 접근 가능한 공식 사이트로 **수상작**을 대조한다. 모든 레코드는 사용한 위키백과 리비전 permalink와 검증 상태를 가진다.

## 5. 자동 수집 가능 vs 수동 검증 필요

자동:
- 위키백과 목록 10개 페이지 파싱(연도·후보·수상 표시·링크 대상), 회차별 문서 216개에서 개최일 추출
- 링크 대상 → 리디렉션 해소 → Wikidata QID로 영화 식별
- 연도별 후보 수·수상자 수 검증(수상자 ≠ 1이면 경고), 목록 페이지 vs 회차 문서 교차 대조
- 공식 사이트 수상작 대조(접근 가능한 곳)

수동 검증:
- 동률 수상(PGA 2014: *12 Years a Slave* / *Gravity*)
- 개최일 이상치(이틀 개최, 기자회견 발표, 연기)
- 외국어 영화의 골든글로브 작품상 부문 자격, WGA 자격, BAFTA 개봉 시기로 인한 시즌 어긋남
- 링크 없는 제목·특수문자 제목의 연결
- 가장 최근 시즌(2026)의 데이터 안정성

## 6. 예상되는 데이터 함정

1. **후보 수 변화**: 오스카 5편(~2009) → 10편(2010–11) → 5~10편 가변(2012–21) → 10편(2022~). PGA 5 → 10편(동률로 6·11편인 해 존재). “후보에 올랐다”의 난이도가 시대마다 다르다.
2. **골든글로브는 매년 수상작이 2편**: 일치율 계산 시 단일 수상 기관과 같은 기준으로 비교하면 과대평가된다 → 부문별·통합 수치를 분리 표시.
3. **골든글로브 외국어 규정**: 대사 절반 이상이 비영어인 영화는 2023년 시상까지 작품상 부문 자격이 없었다(*Parasite*, *Roma* 등). 이 경우 “후보 아님”이 아니라 “자격 없음”.
4. **WGA 자격 제한**: 조합 관할 밖 각본(해외·일부 독립영화)은 후보가 될 수 없다. WGA 불참 ≠ 탈락. 개별 자격 여부를 확인할 공식 목록이 없으므로 `unknown`으로 두고 경고를 표시한다.
5. **BAFTA 자격은 영국 개봉일 기준**: 같은 영화가 다른 시즌 BAFTA에 나올 수 있다 → 시즌 불일치 자동 탐지.
6. **DGA·SAG는 작품상이 아님**: 감독 개인·출연진 상. 해석 시 성격 차이를 표시.
7. **동률**: PGA 2014. 일치 판정에서 “공동 수상 중 하나가 작품상”인 경우를 별도 표기.
8. **제목 표기 차이**: *Birdman or (The Unexpected Virtue of Ignorance)* / *Birdman*, *Borat Subsequent Moviefilm…* 장/단 제목, *Precious: Based on the Novel "Push" by Sapphire* / *Precious*, *tick, tick... BOOM!* / *tick…tick…BOOM!*, *Adaptation.* / *Adaptation*, *Ma Rainey’s* (곡선 아포스트로피), *A Star is Born* 대소문자, *Parasite* / *기생충*. → 제목 문자열이 아니라 위키백과 문서(→ QID)로 연결하고 원 표기는 `aliases`에 보존.
9. **동명·리메이크**: *A Star Is Born*(2018), *Little Women*(2019), *West Side Story*(2021), *True Grit*(2010), *Crash*(2004), *Dune*(2021) vs *Dune: Part Two*, *Wicked* vs *Wicked: For Good*, *Frankenstein*(2025) — 문서 단위 식별로 방지.
10. **투표 주체 변화**: HFPA 해체(2023) 후 골든글로브 투표단 교체, 아카데미 회원 대폭 확대(2016~), 작품상 선호투표 도입(2010). 시대 구분 필터 제공.
11. **표본 크기**: 27개 시즌뿐이다. 모든 비율은 `n/N`과 함께 표시하고, 통념은 데이터로 확인한 뒤에만 서술한다.
12. **위키백과 변경 위험**: 리비전 permalink를 저장하고 공식 사이트와 대조.
13. **명칭 변경**: SAG Awards → Actor Awards(2026), BFCA → Critics Choice Association, DGA 부문 명칭 변경 등. ID는 고정, 표기는 시즌별 이름 유지.

## 7. 최종 웹사이트 페이지 구조

GitHub Pages에서 바로 동작하는 정적 SPA(`docs/`), 해시 라우팅, 외부 라이브러리 없이 순수 HTML/CSS/JS. 데이터는 빌드 스크립트가 만든 `docs/data/orl-data.js` 하나로 로드(로컬 `file://`에서도 동작).

| 경로 | 화면 | 핵심 기능 |
|---|---|---|
| `#/` | 개요 | 27개 시즌 × 핵심 전초전 “작품상 일치” 히트맵, 기관별 일치율(n/N), 주요 질문 바로가기 |
| `#/season/2020` | 시즌 | 시즌 선택, 레이스 요약(사실 + 규칙 기반 라벨 분리), 영화×시상식 성적표, **시즌 타임라인**(개최일 순 누적) |
| `#/explore` | 탐색 | “[상]을 받고도 작품상을 놓친 영화”, “[상] 없이 작품상을 받은 영화”(수상 없음/후보도 없음 구분), 기관·시대 필터 |
| `#/agreement` | 일치율 | 기관별 작품상 일치율, 후보 포함률, 불일치 시즌 목록, 시대별(2000–09 / 2010–19 / 2020–26) |
| `#/patterns` | 패턴 | 요청된 질문들에 대한 데이터 기반 답(규칙·임계값 표시, 조정 가능) |
| `#/film/Q…` | 영화 | 한 영화의 시즌 경로(날짜순 후보·수상), 제목 표기 이력, 출처 |
| `#/data` | 데이터·출처 | 출처 목록, 레코드별 검증 상태, 누락/불확실 목록, 방법론, JSON/CSV 다운로드 |

표현 원칙: 예측 확률·배당률 없음. “선두·역전·이변” 같은 표현은 항상 분석 레이어 라벨로 표시하고 정의 규칙을 옆에 붙인다.
