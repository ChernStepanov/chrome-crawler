#!/bin/sh
# Все тесты: проверка синтаксиса и тесты на Node (vm). Запуск: ./test.sh
cd "$(dirname "$0")"
fail=0
for f in background.js panel/*.js art/*.js page/*.js skript/*.js; do node --check "$f" || { echo "СИНТАКСИС: $f"; fail=1; }; done
for t in */*.test.js; do
  if node "$t" >/dev/null 2>&1; then echo "✓ $t"; else echo "✗ $t"; node "$t" 2>&1 | tail -5; fail=1; fi
done
[ $fail -eq 0 ] && echo "Все тесты прошли." || { echo "Есть ошибки."; exit 1; }
