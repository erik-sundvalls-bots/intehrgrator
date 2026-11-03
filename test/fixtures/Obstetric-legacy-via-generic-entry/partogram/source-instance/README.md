Four partogram compositions in openEHR simplified FLAT JSON for the template `generic-obstetrix-partogram-v1` (`../source-schema/generic_obstetrix_partogram_v1_TEMPLATE.opt`). Each file is one labour. They deserialize against that operational template with no FLAT issues.

The curves follow the shape of published partographs (Philpott and Castle: an alert line of about 1 cm/hour from 4 cm, and an action line four hours to the right; the same lines are on the WHO partograph). The times, measurements and notes are synthetic. They are not a copy of a named case.

**1-primip-left-of-alert.json** — Primip, Förlossning Södersjukhuset. Cervix 4 cm at 08:00, 8 cm at 12:00, fully dilated at 14:00, station −2 then 0. Fetal heart rate 136–148. Clear liquor at 12:00. No oxytocin. The plot stays on or left of a 1 cm/hour alert line.

**2-multip-fast-labour.json** — Multip, Förlossning Karolinska Huddinge. Cervix 5 cm at 14:10 and fully dilated at 16:20, station −1 then +1. Clear liquor, fetal heart rate 146–152. No oxytocin.

**3-primip-crosses-alert-oxytocin.json** — Primip, Förlossning Danderyds sjukhus. Still only 5 cm four hours after 4 cm, so the plot has crossed the alert line. Oxytocin (5 IU in 500 ml) and an epidural follow. Thin meconium, fetal heart rate 168 then 112, scalp lactate 5.4 mmol/L and pH 7.22, then 8 cm at 16:00.

**4-multip-thick-meconium-low-ph.json** — Multip, Förlossning Karolinska Solna. A short chart: 6 cm and a normal heart rate at 03:20, then at 03:40 fetal heart rate 104, thick foul meconium, scalp pH 7.15 and lactate 6.8 mmol/L. Waiting for an action line is the wrong next step.

`höjd` is the station in centimetres relative to the ischial spines (negative is above). Context HSA ids are synthetic.

The template has no value set for several integers. These files use the labels below only as fixture conventions, not as Obstetrix production codes:

| Field | Value | Meaning in these files |
|-------|-------|------------------------|
| `registeredbyprofessionalroleid` | 1 | midwife |
| `flj/typ` | 1 | intermittent auscultation |
| `vattenavgang/typ` | 1 | spontaneous rupture of membranes |
| `vattenavgang/mekoniumfargad` | 0, 1, 2 | none, thin, thick |
| `vattenavgang/vattenamni` | 1 | ordinary amount |
| `station/bjudning` | 1 | cephalic |
| `station/rotation` | 1 | occiput anterior |
| `ctg/typ` | 2 | pathological tracing |
| `smartlindring/typavsmartlindring` | 1 | epidural |
| `supportlineconvergencepointcm` | 10 | support lines drawn through to full dilatation |
