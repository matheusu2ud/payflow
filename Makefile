up:
	npm run dev

stop:
	taskkill /F /IM node.exe 2>NUL || true

migrate:
	npm run migrate

seed:
	npm run seed

test:
	npm test

.PHONY: up stop migrate seed test
