# Automatisation de l'expiration des trials via systemd timer

## Mécanisme

Le système utilise un **systemd timer** pour exécuter automatiquement la vérification et l'expiration des périodes d'essai toutes les heures.

### Fichiers concernés

- `deploy/schoolsafe-control-trial-check.service` : Service one-shot qui appelle l'endpoint `/instances/check-expired-trials`
- `deploy/schoolsafe-control-trial-check.timer` : Timer qui déclenche le service toutes les heures

### Fonctionnement

1. **Timer** : Déclenché 5 minutes après le boot, puis toutes les heures (`OnUnitActiveSec=1h`)
2. **Service** : Exécute une requête HTTP POST vers `http://localhost:3000/instances/check-expired-trials` avec le token admin
3. **Logique métier** :
   - Les instances en statut `trial` dont `trial_started_at` est older que 14 jours passent en statut `grace`
   - Les instances en statut `grace` dont `grace_ends_at` est dépassé passent en statut `suspended`

### Installation

```bash
# Copier les fichiers dans /etc/systemd/system/
sudo cp deploy/schoolsafe-control-trial-check.service /etc/systemd/system/
sudo cp deploy/schoolsafe-control-trial-check.timer /etc/systemd/system/

# Créer le fichier d'environnement avec le token admin
sudo mkdir -p /etc/schoolsafe-control/
echo "ADMIN_TOKEN=votre-token-admin" | sudo tee /etc/schoolsafe-control/env

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
curl -X POST http://localhost:3000/instances/check-expired-trials \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Logs

Les logs du service sont accessibles via :

```bash
journalctl -u schoolsafe-control-trial-check.service -f
```