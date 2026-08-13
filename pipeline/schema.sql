-- 부산 도심하천 수질예보 — Supabase 스키마
-- Supabase SQL 편집기에서 실행. 여러 번 실행해도 안전하다 (IF NOT EXISTS).

-- ─────────────────────────────────────────────────────
-- 실시간 위험도 (ml_pipeline.py 가 upsert)
-- ─────────────────────────────────────────────────────
create table if not exists risk_scores (
  id          bigserial primary key,
  station_id  text        not null,
  river_name  text        not null,
  track       text        not null check (track in ('A', 'B')),
  lat         double precision,
  lng         double precision,
  risk_score  double precision not null,
  risk_level  text        not null check (risk_level in ('low', 'medium', 'high')),
  shap        jsonb,
  updated_at  timestamptz not null default now(),
  unique (station_id, track)
);

-- ─────────────────────────────────────────────────────
-- 48시간 예보 (forecast.py 가 upsert)
-- ─────────────────────────────────────────────────────
create table if not exists risk_forecast (
  id           bigserial primary key,
  station_id   text        not null,
  river_name   text        not null,
  track        text        not null check (track in ('A', 'B')),
  forecast_dt  timestamptz not null,
  hours_ahead  int         not null,
  risk_score   double precision not null,
  risk_level   text        not null check (risk_level in ('low', 'medium', 'high')),
  rain_mm      double precision,
  tide_cm      double precision,
  temp_c       double precision,
  shap         jsonb,
  generated_at timestamptz not null default now(),
  unique (station_id, track, forecast_dt)
);

-- 기존 테이블에 shap 컬럼 추가 (이미 있으면 무시)
-- 이 컬럼이 없으면 프론트가 실시간 SHAP으로 대체하는데,
-- 그 값은 예보 시간이 바뀌어도 고정이라 판단 요소가 변하지 않는다.
alter table risk_forecast add column if not exists shap jsonb;

-- 프론트가 hours_ahead 로 필터하므로 인덱스를 건다
create index if not exists risk_forecast_hours_idx
  on risk_forecast (hours_ahead, station_id);

-- ─────────────────────────────────────────────────────
-- RLS: 대시보드는 anon 키로 읽기만 한다
-- ─────────────────────────────────────────────────────
alter table risk_scores   enable row level security;
alter table risk_forecast enable row level security;

drop policy if exists "public read risk_scores" on risk_scores;
create policy "public read risk_scores"
  on risk_scores for select using (true);

drop policy if exists "public read risk_forecast" on risk_forecast;
create policy "public read risk_forecast"
  on risk_forecast for select using (true);
