#!/bin/sh
# Все тесты: проверка синтаксиса и тесты на Node (vm). Запуск: ./test.sh
cd "$(dirname "$0")"
fail=0
for f in background.js panel/*.js art/*.js page/*.js skript/*.js; do node --check "$f" || { echo "СИНТАКСИС: $f"; fail=1; }; done
for t in */*.test.js; do
  # пройден — только если вышел с кодом 0 И напечатал итоговое «OK»: тест, повисший на незавершённом ожидании,
  # Node тихо завершает с кодом 0 — без этой проверки он сходил за пройденный
  out=$(node "$t" 2>&1); code=$?
  if [ $code -eq 0 ] && printf '%s' "$out" | tail -1 | grep -qi ': ok'; then echo "✓ $t"
  else echo "✗ $t"; printf '%s\n' "$out" | tail -5; [ $code -eq 0 ] && echo "  (тест оборвался, не дойдя до конца: нет итогового OK)"; fail=1; fi
done
[ $fail -eq 0 ] && echo "Все тесты прошли." || { echo "Есть ошибки."; exit 1; }
