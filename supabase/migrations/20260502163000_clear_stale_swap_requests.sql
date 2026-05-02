-- Régi swap kérések és ajánlatok törlése, amelyek a v3.0.32 előtti (hibás)
-- startChild-láncolás alapján jöttek létre. A kiosztások és a kért dátumok
-- eltérnek az újabb, helyes láncolásos számítástól.
-- Az összes swap_offer és swap_request törlése, hogy tesztelők az új
-- (konzisztens) naptár alapján újra létrehozhassák a kéréseket.

delete from public.swap_offers;
delete from public.swap_events;
delete from public.swap_requests;
