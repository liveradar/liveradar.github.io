# LiveRadar

個人用的獨立/地下音樂演出雷達。詳細需求見 [`LIVERADAR-SRS.md`](./LIVERADAR-SRS.md)，技術架構見 [`LIVERADAR-SPEC.md`](./LIVERADAR-SPEC.md)。

## 目前進度

M1~M5 已完成並在瀏覽器實測過，詳見 [`HANDOFF.md`](./HANDOFF.md)（換電腦接續開發請先看這份）。

## 設計稿 / 線框稿

這些是發布在 claude.ai 上的 Claude Design 畫布，跟 Claude 帳號綁定，不是本機檔案，任何裝置登入同帳號都能開：

- [Wireframes（Phase 2 低保真線框）](https://claude.ai/code/artifact/506fe762-8120-406d-b6d5-2be997e137ac)
- [Design Directions（4 個視覺方向比較，已選方向 D）](https://claude.ai/code/artifact/f154a931-41fc-4cd5-9df1-69aeb1e3fb46)
- [Design Comp（Phase 3 正式設計稿，含元件規格表）](https://claude.ai/code/artifact/86c33481-5a15-4dc7-9b4c-690b720da034)

## 本機開發

不需要打包工具（D14）。第一次拉下來要先裝相依套件（爬蟲 pipeline 用得到）：

```bash
npm install
```

開一個本機伺服器看畫面：

```bash
npm run serve
# 或
python3 -m http.server 8000
```

再打開 `http://localhost:8000`。

## 目錄結構

見 `LIVERADAR-SPEC.md` §2。
