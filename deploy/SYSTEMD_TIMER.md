# Automatisation de l'expiration des trials via systemd timer

## Mécanisme

Le système utilise un **systemd timer** pour exécuter automatiquement la vérification et l'expiration des périodes d'essai toutes les heures.

### Fichiers concernés

- `deploy/schoolsafe-control-trial-check.service` : Service one-shot qui appelle l'endpoint `/instances/check-expired-trials`
- `deploy/schoolsafe-control-trial-check.timer` : Timer qui déclenche le service toutes les heures

### Fonctionnement

1. **Timer** : Déclenché 5 minutes après le boot, puis toutes les heures (`OnUnitActiveSec=1h`)
2. **Service** : Charge `CONTROL_API_URL` et `ADMIN_TOKEN` depuis `/etc/schoolsafe-control/env`, puis exécute une requête HTTP POST vers `${CONTROL_API_URL}/instances/check-expired-trials` avec le header `x-admin-token`
3. **Logique métier** :
   - Les instances en statut `trial` dont `trial_started_at` est older que 14 jours passent en statut `grace`
   - Les instances en statut `grace` dont `grace_ends_at` est dépassé passent en statut `suspended`

### Installation

```bash
# Copier les fichiers dans /etc/systemd/system/
sudo cp deploy/schoolsafe-control-trial-check.service /etc/systemd/system/
sudo cp deploy/schoolsafe-control-trial-check.timer /etc/systemd/system/

# Créer le fichier d'environnement protégé
sudo install -d -m 0750 -o root -g schoolsafe /etc/schoolsafe-control
sudo install -m 0640 -o root -g schoolsafe /dev/null /etc/schoolsafe-control/env
sudoedit /etc/schoolsafe-control/env

# Le fichier doit contenir ces deux variables ; remplacer uniquement la valeur secrète
CONTROL_API_URL=http://127.0.0.1:10000
ADMIN_TOKEN=<secret-admin-control>

# Recharger systemd et activer le timer
sudo systemctl daemon-reload
sudo systemctl enable --now schoolsafe-control-trial-check.timer

# Vérifier le statut
sudo systemctl status schoolsafe-control-trial-check.timer
sudo systemctl list-timers schoolsafe-control-trial-check.timer
```

### Vérification manuelle

Pour tester manuellement sans attendre le timer :

```bash
sudo systemctl start schoolsafe-control-trial-check.service
```

Ou directement via curl :

```bash
set -a
. /etc/schoolsafe-control/env
set +a
curl --fail-with-body --silent --show-error --request POST \
  "${CONTROL_API_URL}/instances/check-expired-trials" \
  --header "x-admin-token: ${ADMIN_TOKEN}"
```

### Logs

Les logs du service sont accessibles via :

```bash
journalctl -u schoolsafe-control-trial-check.service -f
```
