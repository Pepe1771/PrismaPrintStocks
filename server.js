const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const SECRET_KEY = process.env.JWT_SECRET || 'secreto_super_seguro';

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'gestor_stock_3d',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

let pool;

async function initDatabase() {
  try {
    pool = mysql.createPool(dbConfig);
    console.log('✅ MySQL Conectado');
    
    const connection = await pool.getConnection();

    // TABLAS
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        registo_id VARCHAR(50),
        clientName VARCHAR(100),
        productBarcode VARCHAR(100),
        quantity INT,
        dueDate DATE,
        status VARCHAR(20) DEFAULT 'pendente',
        timestamp VARCHAR(50),
        orderType VARCHAR(20) DEFAULT 'standard',
        composition LONGTEXT,
        printTime INT DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS maquinas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        registo_id VARCHAR(50),
        nome VARCHAR(100),
        marca VARCHAR(100),
        modelo VARCHAR(100),
        status VARCHAR(20) DEFAULT 'disponivel',
        timestamp VARCHAR(50)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS agendamentos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        registo_id VARCHAR(50),
        printer_id VARCHAR(50),
        title VARCHAR(200),
        start DATETIME,
        end DATETIME,
        filament_id VARCHAR(50),
        weight_used FLOAT,
        color VARCHAR(20),
        timestamp VARCHAR(50)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Migraciones
    try { await connection.execute("ALTER TABLE produtos ADD COLUMN composition LONGTEXT"); } catch (e) {}
    try { await connection.execute("ALTER TABLE produtos ADD COLUMN printTime INT DEFAULT 0"); } catch (e) {}
    try { await connection.execute("ALTER TABLE pedidos ADD COLUMN orderType VARCHAR(20) DEFAULT 'standard'"); } catch (e) {}
    try { await connection.execute("ALTER TABLE pedidos ADD COLUMN composition LONGTEXT"); } catch (e) {}
    try { await connection.execute("ALTER TABLE pedidos ADD COLUMN printTime INT DEFAULT 0"); } catch (e) {}

    connection.release();
  } catch (error) {
    console.error('❌ Error Conexión DB:', error.message);
  }
}

// --- SEGURIDAD ACTIVADA (LOGIN REAL) ---
const verificarToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ success: false, message: 'No token provided' });
    
    // Quitamos 'Bearer ' si viene en el header
    const tokenLimpio = token.replace('Bearer ', '');
    
    jwt.verify(tokenLimpio, SECRET_KEY, (err, decoded) => {
        if (err) return res.status(401).json({ success: false, message: 'Token inválido' });
        req.userId = decoded.id; 
        next();
    });
};

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    // Buscamos usuario en la DB
    const [rows] = await pool.execute('SELECT id, username, name, role FROM utilizadores WHERE username = ? AND password = ?', [username, password]);
    
    if (rows.length > 0) {
      // Generamos Token Real
      const token = jwt.sign({ id: rows[0].id }, SECRET_KEY, { expiresIn: '24h' });
      res.json({ success: true, user: rows[0], token });
    } else { 
      res.status(401).json({ success: false, message: 'Credenciales incorrectas' }); 
    }
  } catch (error) { res.status(500).json({ success: false }); }
});

// GET GLOBAL (PROTEGIDO)
app.get('/api/registos', verificarToken, async (req, res) => {
  try {
    let allRecords = [];
    
    const [fil] = await pool.execute('SELECT * FROM filamentos');
    allRecords = allRecords.concat(fil.map(f => ({ ...f, id: f.registo_id, type: 'filament', weightPerUnit: parseFloat(f.weightPerUnit), pricePerUnit: parseFloat(f.pricePerUnit), minStock: parseFloat(f.minStock) })));
    
    const [prov] = await pool.execute('SELECT * FROM fornecedores');
    allRecords = allRecords.concat(prov.map(s => ({ ...s, id: s.registo_id, type: 'supplier' })));
    
    const [prod] = await pool.execute('SELECT * FROM produtos');
    allRecords = allRecords.concat(prod.map(p => ({ ...p, id: p.registo_id, type: 'product', stock: parseInt(p.stock), salePrice: parseFloat(p.salePrice), cost: parseFloat(p.cost), printTime: parseInt(p.printTime||0), composition: JSON.parse(p.composition || '[]') })));
    
    const [comp] = await pool.execute('SELECT * FROM entradas');
    allRecords = allRecords.concat(comp.map(p => ({ ...p, id: p.registo_id, type: 'purchase', quantityPurchased: parseFloat(p.quantityPurchased) })));
    
    const [imp] = await pool.execute('SELECT * FROM impressoes');
    allRecords = allRecords.concat(imp.map(p => ({ ...p, id: p.registo_id, type: 'print', filamentsUsed: JSON.parse(p.filamentsUsed || '[]') })));
    
    const [ven] = await pool.execute('SELECT * FROM vendas');
    allRecords = allRecords.concat(ven.map(s => ({ ...s, id: s.registo_id, type: 'sale', quantitySold: parseInt(s.quantitySold), totalPrice: parseFloat(s.totalPrice) })));
    
    const [ped] = await pool.execute('SELECT * FROM pedidos');
    allRecords = allRecords.concat(ped.map(o => ({ ...o, id: o.registo_id, type: 'order', quantity: parseInt(o.quantity), printTime: parseInt(o.printTime||0), composition: JSON.parse(o.composition || '[]') })));

    const [maq] = await pool.execute('SELECT * FROM maquinas');
    allRecords = allRecords.concat(maq.map(m => ({ ...m, id: m.registo_id, type: 'printer' })));

    const [agd] = await pool.execute('SELECT * FROM agendamentos');
    allRecords = allRecords.concat(agd.map(a => ({ ...a, id: a.registo_id, type: 'schedule' })));

    res.json({ success: true, data: allRecords });
  } catch (error) { console.error(error); res.status(500).json({ success: false }); }
});

// RUTAS POST (PROTEGIDAS)
app.post('/api/registos/printer', verificarToken, async (req, res) => {
    try { const d = req.body; await pool.execute("INSERT INTO maquinas (registo_id, nome, marca, modelo, timestamp) VALUES (?,?,?,?,?)", [d.id, d.nome, d.marca, d.modelo, d.timestamp]); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/registos/schedule', verificarToken, async (req, res) => {
    try {
        const { id, printer_id, title, start, end, filament_id, weight_used, color, timestamp } = req.body;
        const [conflictos] = await pool.execute(
            `SELECT * FROM agendamentos WHERE printer_id = ? AND ((start < ? AND end > ?) OR (start < ? AND end > ?) OR (start >= ? AND end <= ?))`,
            [printer_id, end, start, end, start, start, end]
        );
        if (conflictos.length > 0) { return res.json({ success: false, message: "⚠️ Conflito de horário! Essa impressora já está ocupada." }); }
        await pool.execute("INSERT INTO agendamentos (registo_id, printer_id, title, start, end, filament_id, weight_used, color, timestamp) VALUES (?,?,?,?,?,?,?,?,?)", [id, printer_id, title, start, end, filament_id, weight_used, color, timestamp]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/registos/filament', verificarToken, async (req, res) => {
    try { const d = req.body; await pool.execute("INSERT INTO filamentos (registo_id, barcode, name, material, color, weightPerUnit, pricePerUnit, minStock, supplier, timestamp) VALUES (?,?,?,?,?,?,?,?,?,?)", [d.id, d.barcode, d.name, d.material, d.color, d.weightPerUnit, d.pricePerUnit, d.minStock, d.supplier, d.timestamp]); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); }
});
app.post('/api/registos/supplier', verificarToken, async (req, res) => {
    try { const d = req.body; await pool.execute("INSERT INTO fornecedores (registo_id, supplierName, supplierEmail, supplierPhone, supplierAddress, timestamp) VALUES (?,?,?,?,?,?)", [d.id, d.supplierName, d.supplierEmail, d.supplierPhone, d.supplierAddress, d.timestamp]); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); }
});
app.post('/api/registos/product', verificarToken, async (req, res) => {
    try { const d = req.body; await pool.execute("INSERT INTO produtos (registo_id, barcode, name, productCategory, stock, cost, salePrice, composition, printTime, timestamp) VALUES (?,?,?,?,?,?,?,?,?,?)", [d.id, d.barcode, d.name, d.productCategory, d.stock, d.cost, d.salePrice, JSON.stringify(d.composition), d.printTime, d.timestamp]); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); }
});
app.post('/api/registos/purchase', verificarToken, async (req, res) => {
    try { 
        const d = req.body; 
        if(d.category === 'product') {
             await pool.execute("INSERT INTO entradas (registo_id, filamentBarcode, quantityPurchased, purchaseDate, supplier, timestamp) VALUES (?,?,?,?,?,?)", [d.id, d.barcode, d.quantityPurchased, d.purchaseDate, d.supplier, d.timestamp]);
             await pool.execute("UPDATE produtos SET stock = stock + ? WHERE barcode = ?", [d.quantityPurchased, d.barcode]);
        } else {
             await pool.execute("INSERT INTO entradas (registo_id, filamentBarcode, quantityPurchased, purchaseDate, supplier, timestamp) VALUES (?,?,?,?,?,?)", [d.id, d.filamentBarcode, d.quantityPurchased, d.purchaseDate, d.supplier, d.timestamp]);
        }
        res.json({ success: true }); 
    } catch (e) { res.status(500).json({ success: false }); }
});
app.post('/api/registos/print', verificarToken, async (req, res) => {
    try { const d = req.body; await pool.execute("INSERT INTO impressoes (registo_id, printName, filamentsUsed, notes, timestamp) VALUES (?,?,?,?,?)", [d.id, d.printName, JSON.stringify(d.filamentsUsed), d.notes, d.timestamp]); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); }
});
app.post('/api/registos/sale', verificarToken, async (req, res) => {
    try { const d = req.body; await pool.execute("INSERT INTO vendas (registo_id, productBarcode, quantitySold, totalPrice, saleDate, timestamp) VALUES (?,?,?,?,?,?)", [d.id, d.productBarcode, d.quantitySold, d.totalPrice, d.saleDate, d.timestamp]); await pool.execute("UPDATE produtos SET stock = stock - ? WHERE barcode = ?", [d.quantitySold, d.productBarcode]); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); }
});
app.post('/api/registos/order', verificarToken, async (req, res) => {
    try { const d = req.body; await pool.execute("INSERT INTO pedidos (registo_id, clientName, productBarcode, quantity, dueDate, status, orderType, composition, printTime, timestamp) VALUES (?,?,?,?,?,?,?,?,?,?)", [d.id, d.clientName, d.productBarcode||null, d.quantity, d.dueDate, 'pendente', d.orderType, JSON.stringify(d.composition||[]), d.printTime||0, d.timestamp]); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); }
});

// DELETE (PROTEGIDO)
app.delete('/api/registos/:type/:id', verificarToken, async (req, res) => {
    try {
        const { type, id } = req.params;
        let table = '';
        if(type==='filament') table='filamentos'; else if(type==='supplier') table='fornecedores'; else if(type==='product') table='produtos'; else if(type==='purchase') table='entradas'; else if(type==='print') table='impressoes'; else if(type==='sale') table='vendas'; else if(type==='order') table='pedidos'; 
        else if(type==='printer') table='maquinas'; else if(type==='schedule') table='agendamentos';
        
        if(!table) return res.status(400).json({success: false});
        await pool.execute(`DELETE FROM ${table} WHERE registo_id = ? OR id = ?`, [id, id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// UPDATES (PROTEGIDOS)
app.put('/api/registos/filament/:id', verificarToken, async (req, res) => {
  try { const { id } = req.params; const d = req.body; await pool.execute("UPDATE filamentos SET barcode=?, name=?, material=?, color=?, weightPerUnit=?, pricePerUnit=?, minStock=?, supplier=? WHERE registo_id=? OR id=?", [d.barcode, d.name, d.material, d.color, d.weightPerUnit, d.pricePerUnit, d.minStock, d.supplier, id, id]); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); }
});
app.put('/api/registos/product/:id', verificarToken, async (req, res) => {
    try { const d = req.body; await pool.execute("UPDATE produtos SET barcode=?, name=?, productCategory=?, stock=?, cost=?, salePrice=?, composition=?, printTime=? WHERE registo_id=? OR id=?", [d.barcode, d.name, d.productCategory, d.stock, d.cost, d.salePrice, JSON.stringify(d.composition), d.printTime, req.params.id, req.params.id]); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); }
});
app.put('/api/registos/supplier/:id', verificarToken, async (req, res) => {
  try { const { id } = req.params; const d = req.body; await pool.execute("UPDATE fornecedores SET supplierName=?, supplierEmail=?, supplierPhone=?, supplierAddress=? WHERE registo_id=? OR id=?", [d.supplierName, d.supplierEmail, d.supplierPhone, d.supplierAddress, id, id]); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); }
});
app.put('/api/registos/purchase/:id', verificarToken, async (req, res) => {
  try { const { id } = req.params; const d = req.body; await pool.execute("UPDATE entradas SET filamentBarcode=?, quantityPurchased=?, purchaseDate=?, supplier=? WHERE registo_id=? OR id=?", [d.filamentBarcode, d.quantityPurchased, d.purchaseDate, d.supplier, id, id]); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); }
});
app.put('/api/registos/print/:id', verificarToken, async (req, res) => {
  try { const { id } = req.params; const d = req.body; await pool.execute("UPDATE impressoes SET printName=?, filamentsUsed=?, notes=? WHERE registo_id=? OR id=?", [d.printName, JSON.stringify(d.filamentsUsed), d.notes, id, id]); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false }); }
});
app.put('/api/registos/sale/:id', verificarToken, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { id } = req.params; const d = req.body;
    const [oldSale] = await conn.execute('SELECT * FROM vendas WHERE registo_id = ? OR id = ?', [id, id]);
    if (oldSale.length > 0) { await conn.execute('UPDATE produtos SET stock = stock + ? WHERE barcode = ?', [oldSale[0].quantitySold, oldSale[0].productBarcode]); }
    await conn.execute('UPDATE vendas SET productBarcode=?, quantitySold=?, totalPrice=?, saleDate=? WHERE registo_id=? OR id=?', [d.productBarcode, d.quantitySold, d.totalPrice, d.saleDate, id, id]);
    await conn.execute('UPDATE produtos SET stock = stock - ? WHERE barcode = ?', [d.quantitySold, d.productBarcode]);
    await conn.commit(); res.json({ success: true });
  } catch (error) { await conn.rollback(); res.status(500).json({ success: false }); } finally { conn.release(); }
});
app.put('/api/registos/order/:id/status', verificarToken, async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const { id } = req.params; const { status } = req.body;
        const [rows] = await conn.execute("SELECT * FROM pedidos WHERE registo_id = ? OR id = ?", [id, id]);
        const ped = rows[0];
        if (status === 'concluido' && ped.status !== 'concluido') {
            if (ped.orderType === 'standard') {
                await conn.execute("UPDATE produtos SET stock = stock - ? WHERE barcode = ?", [ped.quantity, ped.productBarcode]);
            } else {
                await conn.execute("INSERT INTO impressoes (registo_id, printName, filamentsUsed, notes, timestamp) VALUES (?, ?, ?, ?, ?)", [Date.now().toString(), `Pedido: ${ped.clientName}`, ped.composition, 'Auto', new Date().toISOString()]);
            }
        }
        await conn.execute("UPDATE pedidos SET status = ? WHERE registo_id = ? OR id = ?", [status, id, id]);
        await conn.commit(); res.json({ success: true });
    } catch (e) { await conn.rollback(); res.status(500).json({ success: false }); } finally { conn.release(); }
});

async function startServer() {
  await initDatabase();
  app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
}
startServer();
