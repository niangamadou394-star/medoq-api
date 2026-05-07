const db = require('./db');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

console.log('🌱 Seeding database...');

// ─── CLEAR ───────────────────────────────────────────────────────────────────
db.exec(`
  DELETE FROM payments; DELETE FROM reservations; DELETE FROM pharmacy_stock;
  DELETE FROM pharmacy_users; DELETE FROM pharmacies; DELETE FROM medications;
  DELETE FROM refresh_tokens; DELETE FROM users;
`);

// ─── USERS ───────────────────────────────────────────────────────────────────
const passwordHash = bcrypt.hashSync('password123', 10);

const patient1Id = uuidv4();
const phStaff1Id = uuidv4();
const adminId    = uuidv4();

const insertUser = db.prepare(`
  INSERT INTO users (id, phone, email, name, password_hash, role)
  VALUES (?, ?, ?, ?, ?, ?)
`);

insertUser.run(patient1Id, '+221770000001', 'amadou@medoq.sn', 'Amadou Niang',       passwordHash, 'PATIENT');
insertUser.run(phStaff1Id, '+221770000002', 'pharma@medoq.sn', 'Gérant Centrale',    passwordHash, 'PHARMACY_STAFF');
insertUser.run(adminId,    '+221770000099', 'admin@medoq.sn',   'Admin Medoq',        passwordHash, 'ADMIN');

console.log('✅ Users créés');

// ─── MEDICATIONS ─────────────────────────────────────────────────────────────
const insertMed = db.prepare(`
  INSERT INTO medications (id, name, dci, form, dosage, category, requires_prescription, description)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const meds = [
  { id: uuidv4(), name: 'Paracetamol 500mg',   dci: 'Paracétamol',    form: 'Comprimé',              dosage: '500mg',    cat: 'Antalgique',          rx: 0, desc: 'Antalgique et antipyrétique' },
  { id: uuidv4(), name: 'Amoxicilline 500mg',  dci: 'Amoxicilline',   form: 'Gélule',                dosage: '500mg',    cat: 'Antibiotique',         rx: 1, desc: 'Antibiotique à large spectre' },
  { id: uuidv4(), name: 'Ibuprofène 400mg',    dci: 'Ibuprofène',     form: 'Comprimé',              dosage: '400mg',    cat: 'Anti-inflammatoire',   rx: 0, desc: 'Anti-inflammatoire non stéroïdien' },
  { id: uuidv4(), name: 'Coartem 20/120mg',    dci: 'Artéméther/Luméfantrine', form: 'Comprimé',     dosage: '20/120mg', cat: 'Antipaludéen',         rx: 1, desc: 'Traitement antipaludéen de première ligne' },
  { id: uuidv4(), name: 'Doliprane 1000mg',    dci: 'Paracétamol',    form: 'Comprimé effervescent', dosage: '1000mg',   cat: 'Antalgique',           rx: 0, desc: 'Antalgique adulte' },
  { id: uuidv4(), name: 'Metformine 500mg',    dci: 'Metformine',     form: 'Comprimé',              dosage: '500mg',    cat: 'Antidiabétique',       rx: 1, desc: 'Traitement du diabète de type 2' },
  { id: uuidv4(), name: 'Cotrimoxazole 480mg', dci: 'Sulfaméthoxazole/Triméthoprime', form: 'Comprimé', dosage: '480mg', cat: 'Antibiotique',        rx: 1, desc: 'Antibiotique' },
  { id: uuidv4(), name: 'Oméprazole 20mg',     dci: 'Oméprazole',     form: 'Gélule',                dosage: '20mg',     cat: 'Gastro-entérologie',   rx: 0, desc: 'Inhibiteur de la pompe à protons' },
];

meds.forEach(m => insertMed.run(m.id, m.name, m.dci, m.form, m.dosage, m.cat, m.rx, m.desc));
console.log(`✅ ${meds.length} médicaments créés`);

// ─── PHARMACIES ──────────────────────────────────────────────────────────────
const insertPharma = db.prepare(`
  INSERT INTO pharmacies (id, name, address, latitude, longitude, phone, opening_hours, is_active, is_verified, license_number, rating, review_count)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)
`);

const pharmacies = [
  { id: uuidv4(), name: 'Pharmacie Centrale du Plateau', addr: 'Av. L. S. Senghor, Plateau, Dakar',      lat: 14.6892, lng: -17.4443, phone: '+221338234567', hours: '24h/24',        lic: 'PH-DK-001', rating: 4.8, reviews: 127 },
  { id: uuidv4(), name: 'Pharmacie des Almadies',         addr: 'Route des Almadies, Dakar',              lat: 14.7468, lng: -17.5142, phone: '+221338201234', hours: '08h - 22h',     lic: 'PH-DK-002', rating: 4.6, reviews: 89  },
  { id: uuidv4(), name: 'Pharmacie Mermoz',               addr: 'Bd du General de Gaulle, Mermoz',        lat: 14.7074, lng: -17.4718, phone: '+221338607890', hours: '08h30 - 21h30', lic: 'PH-DK-003', rating: 4.5, reviews: 64  },
  { id: uuidv4(), name: 'Pharmacie Liberte 6',            addr: 'Rue 10, Liberte 6, Dakar',               lat: 14.7214, lng: -17.4562, phone: '+221338563412', hours: '08h - 20h',     lic: 'PH-DK-004', rating: 4.3, reviews: 41  },
  { id: uuidv4(), name: 'Pharmacie Point E',              addr: 'Av. Cheikh Anta Diop, Point E',          lat: 14.6956, lng: -17.4576, phone: '+221338234568', hours: '08h - 22h',     lic: 'PH-DK-005', rating: 4.4, reviews: 72  },
  { id: uuidv4(), name: 'Pharmacie Sacre-Coeur',          addr: 'Sacre-Coeur 3, Dakar',                   lat: 14.7156, lng: -17.4689, phone: '+221338607891', hours: '08h - 22h30',   lic: 'PH-DK-006', rating: 4.5, reviews: 93  },
  { id: uuidv4(), name: 'Pharmacie Fann Residence',       addr: 'Av. Pasteur, Fann, Dakar',               lat: 14.6934, lng: -17.4612, phone: '+221338563413', hours: '24h/24',        lic: 'PH-DK-007', rating: 4.7, reviews: 108 },
  { id: uuidv4(), name: 'Pharmacie Grand Dakar',          addr: 'Route du Front de Terre, Grand Dakar',   lat: 14.7078, lng: -17.4412, phone: '+221338201236', hours: '08h - 21h30',   lic: 'PH-DK-008', rating: 4.3, reviews: 61  },
  { id: uuidv4(), name: 'Pharmacie Medina',               addr: 'Av. Blaise Diagne, Medina, Dakar',       lat: 14.6912, lng: -17.4534, phone: '+221338234569', hours: '08h - 20h',     lic: 'PH-DK-009', rating: 4.1, reviews: 38  },
  { id: uuidv4(), name: 'Pharmacie Ouakam',               addr: 'Route de Ouakam, Dakar',                 lat: 14.7234, lng: -17.4867, phone: '+221338201235', hours: '08h - 21h',     lic: 'PH-DK-010', rating: 4.2, reviews: 55  },
];

pharmacies.forEach(p => insertPharma.run(p.id, p.name, p.addr, p.lat, p.lng, p.phone, p.hours, p.lic, p.rating, p.reviews));
console.log(`✅ ${pharmacies.length} pharmacies créées`);

// ─── LINK STAFF TO PHARMACY ───────────────────────────────────────────────────
db.prepare(`INSERT INTO pharmacy_users (id, pharmacy_id, user_id) VALUES (?, ?, ?)`)
  .run(uuidv4(), pharmacies[0].id, phStaff1Id);

// ─── STOCK ───────────────────────────────────────────────────────────────────
const insertStock = db.prepare(`
  INSERT INTO pharmacy_stock (id, pharmacy_id, medication_id, quantity, price, threshold)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const stockData = [
  // Pharmacie Centrale
  [pharmacies[0].id, meds[0].id, 45, 1500, 10], // Paracetamol
  [pharmacies[0].id, meds[1].id, 12, 3200, 15], // Amoxicilline
  [pharmacies[0].id, meds[2].id, 8,  2100, 10], // Ibuprofène
  [pharmacies[0].id, meds[4].id, 20, 1800, 10], // Doliprane
  [pharmacies[0].id, meds[6].id, 30, 900,  10], // Cotrimoxazole
  [pharmacies[0].id, meds[7].id, 25, 2500, 8 ], // Oméprazole
  // Pharmacie des Almadies
  [pharmacies[1].id, meds[0].id, 30, 1500, 10],
  [pharmacies[1].id, meds[3].id, 3,  4500, 5 ], // Coartem
  [pharmacies[1].id, meds[4].id, 0,  1800, 10],
  [pharmacies[1].id, meds[5].id, 15, 1200, 8 ], // Metformine
  // Pharmacie Mermoz
  [pharmacies[2].id, meds[1].id, 5,  3400, 15],
  [pharmacies[2].id, meds[2].id, 0,  2100, 10],
  [pharmacies[2].id, meds[5].id, 15, 1200, 8 ],
  [pharmacies[2].id, meds[7].id, 10, 2600, 8 ],
  // Pharmacie Liberte 6
  [pharmacies[3].id, meds[0].id, 60, 1400, 10],
  [pharmacies[3].id, meds[3].id, 0,  4500, 5 ],
  [pharmacies[3].id, meds[4].id, 10, 1850, 10],
  [pharmacies[3].id, meds[6].id, 20, 950,  10],
  // Pharmacie Point E
  [pharmacies[4].id, meds[0].id, 35, 1500, 10],
  [pharmacies[4].id, meds[2].id, 12, 2100, 10],
  [pharmacies[4].id, meds[4].id, 18, 1800, 10],
  [pharmacies[4].id, meds[7].id, 8,  2500, 8 ],
  // Pharmacie Sacre-Coeur
  [pharmacies[5].id, meds[0].id, 50, 1500, 10],
  [pharmacies[5].id, meds[1].id, 7,  3300, 15],
  [pharmacies[5].id, meds[3].id, 4,  4500, 5 ],
  [pharmacies[5].id, meds[5].id, 20, 1200, 8 ],
  [pharmacies[5].id, meds[6].id, 25, 900,  10],
  // Pharmacie Fann Residence (24h)
  [pharmacies[6].id, meds[0].id, 80, 1500, 15],
  [pharmacies[6].id, meds[1].id, 20, 3200, 15],
  [pharmacies[6].id, meds[2].id, 15, 2100, 10],
  [pharmacies[6].id, meds[3].id, 6,  4500, 5 ],
  [pharmacies[6].id, meds[4].id, 30, 1800, 10],
  [pharmacies[6].id, meds[5].id, 25, 1200, 8 ],
  [pharmacies[6].id, meds[6].id, 40, 900,  10],
  [pharmacies[6].id, meds[7].id, 18, 2500, 8 ],
  // Pharmacie Grand Dakar
  [pharmacies[7].id, meds[0].id, 40, 1450, 10],
  [pharmacies[7].id, meds[4].id, 15, 1800, 10],
  [pharmacies[7].id, meds[6].id, 22, 900,  10],
  // Pharmacie Medina
  [pharmacies[8].id, meds[0].id, 25, 1400, 10],
  [pharmacies[8].id, meds[2].id, 3,  2100, 10],
  [pharmacies[8].id, meds[5].id, 12, 1200, 8 ],
  // Pharmacie Ouakam
  [pharmacies[9].id, meds[0].id, 20, 1500, 10],
  [pharmacies[9].id, meds[4].id, 8,  1800, 10],
  [pharmacies[9].id, meds[7].id, 5,  2600, 8 ],
];

stockData.forEach(s => insertStock.run(uuidv4(), ...s));
console.log(`✅ ${stockData.length} entrées stock créées`);

console.log('\n🎉 Base de données prête !');
console.log('👤 Patient  : +221770000001 / password123');
console.log('🏥 Pharmacie: +221770000002 / password123');
console.log('⚙️  Admin    : +221770000099 / password123');
