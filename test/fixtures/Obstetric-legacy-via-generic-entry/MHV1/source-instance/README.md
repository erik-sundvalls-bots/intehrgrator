Four MHV1 compositions in openEHR simplified FLAT JSON for the template `generic-obstetrix-mhv1-v1` (`../source-schema/generic_obstetrix_mhv1_v1_TEMPLATE.opt`). Each file is one composition. The clinical stories and `Mhv1_id` values match `test/fixtures/Obstetrix-MHV1/source-instance`.

**1-primigravida-basprogram.json** — First pregnancy, MVC Södermalm. Regular cycle, lives with the father, full-time work, no smoking, no prior pregnancies or medication, **Basprogram**.

**2-ivf-multipara.json** — IVF after three years of infertility, MVC Liljeholmen. Previous miscarriage (2019) and live birth (2021). Hypothyroidism + asthma, former smoker who quit at a positive test, ultrasound EDD transferred, **MHV3**.

**3-komplex-mhv3.json** — Single, housing problems, MVC Gottsunda. IUD removed, irregular menses, ongoing tobacco and snus, previous C-section with transfusion, depression on sertraline, AUDIT-C 3 points, **MHV3**.

**4-nightly-primigravida.json** — Same basprogram shape as the first file, with the nightly registration date from the JSON fixture (booking in 2026, dates of the pregnancy still in 2025).

Integer codes are paired with the required text fields (tobacco 1/2/3 = Nej / 1–9 cig / ≥10 cig; snus 1/2 = Nej / Ja; pregnancy type 2/3/5 = miscarriage / induced abortion / live birth). The blood-pressure reading is in `anteckning`, because `bp_comp` is a date-time in this template. There is no personal identity number and no correction-log cluster. Context HSA ids are synthetic; the unit number is still `avd_id`.
