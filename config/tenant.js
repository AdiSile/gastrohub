Am scanat fișierul integral. **Nu există linii markdown** în `config/tenant.js`. Fișierul conține exclusiv:

- Comentarii JavaScript pe o singură linie (`// ...`)
- Blocuri JSDoc (`/** ... */`) cu adnotări `@param`, `@returns`, `@type`
- Separatori vizuali în comentarii (`// ---`)
- Cod JavaScript (funcții, obiecte, `require`, `module.exports`)

Nu s-au identificat elemente specifice sintaxei markdown: heading-uri (`#`, `##`), liste (`-`, `*`), bold (`**text**`), italic (`_text_`), link-uri (`[text](url)`), blocuri de cod (`` ``` ``), tabele, imagini, sau blockquote-uri (`>`). Fișierul este JavaScript pur, fără conținut markdown embedded.