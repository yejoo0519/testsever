# 주간 비밸 랭킹

길드전 배치 화면 스크린샷을 올리면 닉네임과 1·2·3번용 드래곤의 체력/공격/방어를 읽어서
주차별 비밸(체력 × 공격 × 방어) 랭킹을 만드는 사이트.

- 공개: `#/ranking` — 주차별 합산 / 1번용 / 2번용 / 3번용 랭킹
- 관리: `#/login` → 주간 랭킹(제출 현황·미제출) · 스펙 입력 · 길드원 · 주차·버프 · 계정(마스터) · 기록(마스터)

## 처음 설정

1. Supabase 대시보드 → SQL Editor → `setup.sql` 전체를 붙여넣고 Run
2. Authentication → Sign In / Providers → **Allow new users to sign up 끄기**
3. Authentication → Users → Add user (이메일·비밀번호, Auto Confirm 체크)
4. SQL Editor 에서 `insert into go_admins(email, role) values ('그 이메일', 'master');`
5. GitHub 저장소 Settings → Pages → Branch `main` / `/ (root)`

글자 인식은 Tesseract.js(`vendor/tesseract`)를 브라우저에서 돌려서, 스크린샷은 서버로 보내지 않음.
드래곤 그림은 작은 썸네일로 잘라서 기록에 같이 저장.
