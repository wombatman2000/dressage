# Dressage

Appli web installable (iPhone et Android) pour entraîner le chien : séances à la maison, missions en balade, 45 exercices sur 11 ordres, progression partagée entre plusieurs personnes.

## Mise en ligne (GitHub Pages)

1. Crée un dépôt `dressage` sur GitHub et dépose tous les fichiers de ce dossier à la racine.
2. Settings › Pages › Source : *Deploy from a branch*, branche `main`, dossier `/ (root)`.
3. Ouvre l'adresse indiquée (https://<compte>.github.io/dressage/) dans Safari › Partager › **Sur l'écran d'accueil**.

## Partage et synchronisation (Firebase, gratuit)

Une seule personne le fait, une seule fois :

1. console.firebase.google.com › créer un projet.
2. Firestore Database › Créer une base de données › emplacement en Europe › mode production.
3. Onglet Règles : coller le contenu de `firestore.rules`, puis Publier.
4. Paramètres du projet › Vos applications › Web (`</>`) › copier le bloc `firebaseConfig`.
5. Dans l'appli : Réglages › Partage › coller la configuration › Enregistrer › **Créer le partage**.
6. **Inviter quelqu'un** : la personne colle le code reçu dans Réglages › Rejoindre.

Chaque essai noté est un enregistrement indépendant : deux téléphones peuvent noter en même temps, même hors ligne, sans rien écraser.

## Rappels en arrivant à la maison (iPhone)

Raccourcis › Automatisation › + › **Arriver** › domicile › Exécuter immédiatement › action **Afficher une notification**.
Même chose avec **Partir** pour le rappel des missions de balade. Les textes à coller sont dans Réglages de l'appli.

## Comment l'appli choisit les exercices

- Chaque exercice a une maîtrise de 0 à 5 : +1 par réussite, −1 par échec.
- Plus la maîtrise est basse et plus les 5 derniers essais sont ratés, plus il revient souvent ; un exercice raté pendant une séance est reproposé en fin de séance.
- Les exercices bien maîtrisés reviennent de loin en loin (révision espacée).
- Le niveau 2 d'un ordre se débloque quand un exercice de niveau 1 atteint 3 réussites d'avance (pareil pour le niveau 3). On peut aussi débloquer à la main.
