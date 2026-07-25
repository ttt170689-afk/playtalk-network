# Как быстро залить на GitHub

## Вариант 1 — через сайт GitHub
1. Создай новый репозиторий на GitHub.
2. Нажми **Add file** → **Upload files**.
3. Перетащи все файлы из папки `network-playtalk-vercel`.
4. Нажми **Commit changes**.

## Вариант 2 — через Git локально
```bash
git init
git add .
git commit -m "PlayTalk network MVP"
git branch -M main
git remote add origin https://github.com/USERNAME/REPO.git
git push -u origin main
```

## Что должно быть в репозитории
- index.html
- styles.css
- app.js
- config.js
- config.example.js
- supabase-schema.sql
- vercel.json
- README.md
- .gitignore
