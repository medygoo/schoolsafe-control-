/**
 * Script utilitaire pour générer les icônes PWA/favicon à partir du logo principal.
 * Utilise sharp si disponible, sinon fallback manuel.
 * Usage: node scripts/generate-icons.js
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

// Tailles requises
const SIZES = [
  { name: "favicon-16.png", size: 16 },
  { name: "favicon-32.png", size: 32 },
  { name: "apple-touch-icon.png", size: 180 }, // Apple recommande 180x180
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
];

const PUBLIC_DIR = join(rootDir, "public");

console.log("Génération des icônes SchoolSafe Control...");
console.log(`Répertoire public: ${PUBLIC_DIR}`);

// Note: Ce script est un placeholder. En production, utiliser sharp ou un outil externe.
// Pour l'instant, nous copions simplement le logo existant comme base.
// Les vraies redimensionnements nécessitent une bibliothèque d'image.

console.log("\nTailles requises:");
SIZES.forEach(s => console.log(`  - ${s.name}: ${s.size}x${s.size}`));

console.log("\nPour générer correctement ces icônes, exécutez:");
console.log("  npm install --save-dev sharp");
console.log("Puis adaptez ce script pour utiliser sharp.resize().");

// Créer un manifest.json de base si inexistant
const manifestPath = join(PUBLIC_DIR, "manifest.json");
const manifest = {
  name: "SchoolSafe Control",
  short_name: "SS Control",
  description: "Application centrale de gestion des instances SchoolSafe",
  start_url: "/",
  display: "standalone",
  background_color: "#0b1a3a",
  theme_color: "#0b1a3a",
  icons: SIZES.filter(s => s.name.startsWith("icon")).map(s => ({
    src: `/${s.name}`,
    sizes: `${s.size}x${s.size}`,
    type: "image/png"
  }))
};

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
console.log(`\nManifest créé: ${manifestPath}`);

console.log("\nTerminé.");