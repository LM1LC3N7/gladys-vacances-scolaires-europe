# Vacances scolaires Europe

Intégration non officielle. Elle ajoute à Gladys les **vacances scolaires de
votre région** dans plusieurs pays d’Europe (hors France) : Land allemand,
Bundesland autrichien, canton suisse, communauté belge, région néerlandaise,
voïvodie polonaise… sous forme de **calendrier**. Les données viennent de
l’**API OpenHolidays** (<https://www.openholidaysapi.org>), publique, sans
compte ni clé.

La France n’est pas proposée : ses vacances scolaires (zones A, B, C) sont
dans l’intégration **gladys-holidays**.

Elle a été essayée avec la vraie API OpenHolidays et une Gladys 5.3 de test
(calendrier rempli, scènes non essayées) ; signalez toute date fausse.

## Mise en place

1. Installez l’intégration (Gladys 5.3.0 ou plus). Rien à remplir dans son
   écran de configuration.
2. Chaque utilisateur qui le souhaite ouvre la page de l’intégration, bloc
   **« Mes calendriers »**, et l’active :
   - **Pays** : dans la liste.
   - **Régions** (jusqu’à 3, séparées par des virgules) : le code
     (`DE-BY`, `AT-WI` ou `AT-9`, `CH-ZH`, `BE-FR`), le code sans le pays (`BY`) ou le
     nom dans une langue de l’API (`Bayern`, `Bavaria`, `Zürich`). Les
     accents et majuscules ne comptent pas. Laissez vide pour un pays sans
     régions (Luxembourg, Estonie, Lituanie, Andorre, Liechtenstein…).
3. Un calendrier **« Vacances scolaires – <région> »** apparaît par région,
   rempli des vacances du 1er du mois en cours jusqu’à 13 mois plus tard.

Un nom qui désigne plusieurs régions, ou une région inconnue, ne change rien
aux calendriers déjà là : le statut de l’intégration (vu par
l’administrateur) dit quoi corriger. Le bouton **« Lister les régions »**
(écran de configuration, administrateur) donne les codes et noms d’un pays.

Selon le pays, l’API connaît aussi des groupes : communautés belges
(`BE-FR`, `BE-NL`, `BE-DE`), régions néerlandaises (`NL-NO`, `NL-MI`,
`NL-ZU`), types d’école en Mecklembourg (`DE-MV-ABS`, `DE-MV-BBS`), régions
scolaires suisses. Une région donne aussi les vacances nationales et celles
de la région au-dessus (une commune hérite de son canton).

## Scènes : « aujourd’hui en vacances »

Un calendrier poussé est **privé** au départ. Pour qu’il serve aux scènes,
partagez-le (bouton **Partagé** dans « Mes calendriers ») : il est alors
visible par toute la maison et les scènes le lisent, par exemple :

- déclencheur **« Un événement de calendrier arrive »** (veille de la
  rentrée, premier jour des vacances) ;
- condition **« Un événement est en cours »** sur ce calendrier : vraie un
  jour de vacances (pour ne pas lancer le réveil des enfants).

Il n’y a pas d’appareil : le calendrier suffit.

## Ce que fait l’intégration

- **Lecture** : une fois par jour au plus par région (une fois par semaine
  pour les listes de régions), quel que soit le nombre de redémarrages ou de
  clics. La date de la donnée et de la dernière tentative sont gardées dans
  `/data`.
- **Réponse vide** pour une région qui avait des vacances : les vacances
  déjà lues sont gardées (et signalées dans le statut) jusqu’à la troisième
  réponse vide d’affilée, à un jour d’écart (l’API répond « rien » à ce
  qu’elle ne connaît pas).
- **Réponse illisible** (page de maintenance, pas une liste, coupée) : traitée
  comme une panne, suspendue comme ci-dessous. Plus de 500 vacances pour une
  région : refusées et signalées dans le statut.
- **Panne de l’API** : toute requête est suspendue 60 s, puis 2 min,
  4 min… jusqu’à 6 h, en respectant l’en-tête `Retry-After` ; les vacances
  déjà lues restent dans le calendrier. Réponses limitées à 1 Mo (2 Mo pour
  les listes de régions) et à 20 s.
- **Écritures dans Gladys** : 25 par minute au plus (Gladys en accepte 30) ;
  rien n’est renvoyé quand rien n’a changé.
- **Passé conservé** : seule la fenêtre en cours (du 1er du mois à 13 mois)
  est remplacée ; les vacances passées restent dans le calendrier.
- **Calendrier non synchronisé** (bouton **Synchroniser** coupé) : il ne
  reçoit plus rien ; rallumé, il est rempli de nouveau.
- Les jours de « rentrée » et de « fin des cours » de l’API ne sont pas des
  vacances : ils ne sont pas repris. Une demi-journée est notée dans la
  description de l’événement. Une même période donnée une fois par type
  d’école (Zurich : `CH-ZH-VS` Volksschulen, `CH-ZH-MS` Mittelschulen…) avec
  les mêmes dates n’apparaît qu’une fois ; pour les dates d’un seul type
  d’école, indiquez son code de groupe. La description d’un événement nomme
  les types d’école concernés : deux événements de même nom qui se
  chevauchent (Mecklembourg : « Sommerferien » pour ABS et pour BBS) sont
  deux types d’école, et la condition de scène « un événement est en cours »
  est vraie sur les deux.
- Les vacances sont des événements « journée entière », rangés aux minuits
  du fuseau de Gladys (fuseaux de UTC-11 à UTC+11).

## Pays

Proposés : Albanie, Allemagne, Andorre, Autriche, Belgique, Biélorussie,
Bulgarie, Croatie, Espagne, Estonie, Hongrie, Irlande, Italie, Lettonie,
Liechtenstein, Lituanie, Luxembourg, Malte, Moldavie, Monaco, Pays-Bas,
Pologne, Portugal, Roumanie, Saint-Marin, Serbie, Slovaquie, Slovénie,
Suisse, Tchéquie.

Le catalogue de Gladys range une intégration dans 20 pays au plus : ici les
14 dont les vacances 2026-2027 sont dans l’API (Allemagne, Andorre,
Autriche, Belgique, Estonie, Liechtenstein, Lituanie, Luxembourg, Pays-Bas,
Pologne, Portugal, Slovaquie, Suisse, Tchéquie), puis les 6 pays de l’UE les
plus peuplés qui attendent les leurs (Italie, Espagne, Roumanie, Hongrie,
Bulgarie, Irlande). Les 10 autres (Albanie, Biélorussie, Croatie, Lettonie,
Malte, Moldavie, Monaco, Saint-Marin, Serbie, Slovénie) sont proposés quand
même : la recherche du catalogue trouve l’intégration depuis tout pays.

La couverture dépend de l’API : certains pays publient leur année scolaire
tard (le 14 novembre 2026, rien encore pour 2026-2027 en Albanie,
Biélorussie, Bulgarie, Croatie, Espagne, Hongrie, Irlande, Italie, Lettonie,
Malte, Moldavie, Monaco, Roumanie, Saint-Marin, Serbie et Slovénie). Un
calendrier vide se remplit dès que l’API a les dates.

## Données et licence

Contient des informations de l’API OpenHolidays
(<https://www.openholidaysapi.org>), mises à disposition sous la licence
Open Database License (ODbL-1.0,
<https://github.com/openpotato/openholidaysapi.data/blob/main/LICENSE>).
L’intégration appelle l’API et n’embarque aucune de ses données ; le serveur
de l’API (AGPL-3.0) n’est ni copié ni porté. Chaque calendrier et chaque
événement citent la source. L’intégration elle-même est sous licence
Apache-2.0.
