# Gyümölcsnaptár MVP - V1

Kiadás dátuma: 2026-04-22

## Mi van benne

- Havi gyümölcsbeosztás generálás munkanapokra.
- Magyar ünnepnapok figyelembevétele.
- Havi extra szünnapok kezelése.
- Havi rotációs folytatás (előző/következő hónap gombok).
- Hónaponként mentett állapot:
  - kezdő gyerek,
  - szünnapok,
  - kézi napi módosítások.
- Nyomtatási előnézet az oldalon.
- PDF és JPG export.
- Referencia-közeli nyomtatási design és fejléckép.

## Fontos használat

- A rendszer helyi böngésző-tárolóba ment (`localStorage`), tehát ugyanazon a gépen és böngészőben maradnak meg az adatok.
- A `Nyomtatás / PDF letöltés` és `JPG letöltés` a nyomtatási előnézet szerinti képet exportálja.
