# Raport Scanare Markdown – restaurantModel.js

- **Fișier scanat:** `models/restaurantModel.js`
- **Data scanării:** 2025-01-27
- **Scop:** Identificarea liniilor care conțin sintaxă markdown (headere, bold, italic, link-uri, imagini, liste, tabele, backtick-uri, strikethrough, HTML)

## Rezumat

| Element Markdown | Pattern căutat | Linii găsite |
|-----------------|----------------|-------------|
| Headere (`#`) | `^#` | 0 |
| Bold (`**`) | `\*\*` | (doar `/**` JSDoc) |
| Italic (`*text*`) | N/A (greu de diferențiat de operatori) | 0 |
| Link-uri (`[text](url)`) | `\[.*\](.*)` | 0 |
| Imagini (`![alt](url)`) | `\!\[` | 0 |
| Liste (`- `) | `^\-\ ` | 0 |
| Backtick-uri triple (```) | ``` | 0 |
| Backtick-uri simple (`` ` ``) | `` ` `` | 0 |
| Strikethrough (`~~`) | `~~` | 0 |
| Pipe (tabele) | `\|` | (doar operator `\|\|` JS) |
| Tag-uri HTML | `<[a-zA-Z]` | (doar în JSDoc) |

## Concluzie

**0 (zero) linii markdown găsite.** Fișierul este curat, conține exclusiv cod JavaScript cu comentarii JSDoc și comentarii inline. Nu există fragmente de markdown, documentație în format markdown, sau artefacte de markup.
