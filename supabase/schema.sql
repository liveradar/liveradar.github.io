-- LiveRadar — Supabase schema 備份（純文件用途）
--
-- 這份檔案不是自動部署腳本，也不接任何 CLI migration 流程——這個專案刻意
-- 不用 bundler／盡量少依賴（SPEC D14），資料庫這邊維持同樣精神：改動一律
-- 在 Supabase 後台 SQL Editor 手動執行，改完再回來更新這份檔案存檔，方便
-- 之後比對「後台現在的設定跟這裡記的是否一致」，或换人接手時能一眼看懂
-- 權限規則長怎樣，不用重新去後台一條條查。
--
-- 最後對照日期：2026-09-21（透過 pg_policy 系統目錄查詢後台實際設定，
-- 詳見 HANDOFF.md 的 Supabase 登入章節）。

-- ============================================================
-- Table: public.user_prefs
-- ============================================================
-- 每個登入使用者一列，key 是 auth.uid()。存的內容跟舊版 Gist 同步的範圍
-- 一樣：favorites／excluded_artists／excluded_types／mute_keywords／
-- strict_mode（prefs 欄位），加上手動新增的場次（manual_events 欄位）。
--
-- create table public.user_prefs (
--   user_id uuid primary key references auth.users(id),
--   prefs jsonb not null,
--   manual_events jsonb,
--   updated_at timestamptz not null default now()
-- );
--
-- alter table public.user_prefs enable row level security;
--
-- 「自動曝光新表」被關掉，所以額外需要：
-- grant select, insert, update on public.user_prefs to authenticated;
-- （沒有 grant 給 anon——匿名完全連不到這張表，測過會回傳
--   401 permission denied，這是預期行為。）

-- RLS policies（2026-09-21 查詢確認跟下面一致，INSERT/UPDATE 都有
-- WITH CHECK，無法覆寫別人的資料）：

create policy "select own prefs"
on public.user_prefs
for select
using (auth.uid() = user_id);

create policy "insert own prefs"
on public.user_prefs
for insert
with check (auth.uid() = user_id);

create policy "update own prefs"
on public.user_prefs
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- 查詢後台實際 policy 內容用的指令（跑在 Supabase SQL Editor）：
--
-- select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr,
--        pg_get_expr(polwithcheck, polrelid) as with_check_expr
-- from pg_policy
-- where polrelid = 'public.user_prefs'::regclass;

-- ============================================================
-- Table: public.event_reports
-- ============================================================
-- 2026-09-22（Max: 使用者可以回報有誤的場次資訊，Max 確認後回來改程式）。
-- 寫入用途，前端只 INSERT，刻意沒有 SELECT policy——連回報的人自己都讀不回
-- 來，Max 直接在 Supabase 後台 Table Editor 看，跟這個專案其他表一樣不另外
-- 做一個管理畫面。匿名（沒登入）也能回報，reporter_user_id 純粹是「如果當
-- 下有登入就順便記一下是誰」，不是必要欄位。
--
-- 最後對照日期：2026-09-22。Max 在後台跑完這段 SQL 後，透過瀏覽器實際送出
-- 一筆測試回報驗證過（真的寫進表裡，查得到 event_id/event_title），驗證
-- 完直接用 SQL Editor 的 delete 清掉那筆測試資料，不留在正式資料裡。
--
-- create table public.event_reports (
--   id uuid primary key default gen_random_uuid(),
--   event_id text not null,
--   event_title text not null,
--   event_url text,
--   description text not null,
--   reporter_user_id uuid references auth.users(id),
--   page_url text,
--   created_at timestamptz not null default now(),
--   status text not null default 'open'
-- );
--
-- alter table public.event_reports enable row level security;
--
-- create policy "anyone can report"
-- on public.event_reports
-- for insert
-- with check (true);
--
-- 「自動曝光新表」被關掉，所以額外需要：
-- grant insert on public.event_reports to anon, authenticated;
-- （沒有 grant select/update/delete 給任何角色——前端完全無法讀取或竄改
--   既有回報，只能新增一筆新的。）

-- ============================================================
-- Auth: Redirect URLs（Authentication → URL Configuration）
-- ============================================================
-- 2026-09-21 收窄過，原本 https://liveradar.github.io/** 太寬（整個網域
-- 下任何路徑都算合法跳轉終點），改成只留「使用 Google 登入」按鈕實際存在
-- 的頁面（settings.html，見 src/app.js 的 initSettings()）：
--
--   http://localhost:8000/**              （本機開發用，外部打不到）
--   https://liveradar.github.io/settings.html
--
-- 這份清單本身沒有對應的 SQL／API 可查詢備份，只能在後台頁面手動核對。
