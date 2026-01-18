const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// ✅ CONFIGURACIÓN BASE DE DATOS
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

    // 1. TABLAS EXISTENTES
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
        composition LONGTEXT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 2. NUEVAS TABLAS (MÁQUINAS Y CALENDARIO)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS maquinas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        registo_id VARCHAR(50),
        nome VARCHAR(100),
        marca VARCHAR(100),
        modelo VARCHAR(100),
        status VARCHAR(20) DEFAULT 'disponível',
        timestamp VARCHAR(50)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS agendamentos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        registo_id VARCHAR(50),
        printer_id VARCHAR(50),
        order_id VARCHAR(50),
        title VARCHAR(200),
        start DATETIME,
        end DATETIME,
        status VARCHAR(20) DEFAULT 'pendente',
        color VARCHAR(20) DEFAULT '#3b82f6',
        notes TEXT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    
    // MIGRACIONES (Asegurar columnas en tablas viejas)
    try { await connection.execute("ALTER TABLE produtos ADD COLUMN composition LONGTEXT"); } catch (e) { }
    try { 
        await connection.execute("ALTER TABLE pedidos ADD COLUMN orderType VARCHAR(20) DEFAULT 'standard'");
        await connection.execute("ALTER TABLE pedidos ADD COLUMN composition LONGTEXT");
    } catch (e) { }

    connection.release();
  } catch (error) {
    console.error('❌ Error Conexión DB:', error.message);
  }
}

// ==================== AUTENTICAÇÃO ====================
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const [rows] = await pool.execute(
      'SELECT id, username, name, role FROM utilizadores WHERE username = ? AND password = ?',
      [username, password]
    );
    if (rows.length > 0) {
      res.json({ success: true, user: rows[0] });
    } else {
      res.status(401).json({ success: false, message: 'Credenciales inválidas' });
    }
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ==================== RUTAS NUEVAS (MÁQUINAS Y CALENDARIO) ====================

// 1. REGISTRAR MÁQUINA
app.post('/api/registos/machine', async (req, res) => {
    try {
        const data = req.body;
        const sql = `INSERT INTO maquinas (registo_id, nome, marca, modelo, status, timestamp) VALUES (?, ?, ?, ?, ?, ?)`;
        await pool.execute(sql, [data.id, data.nome, data.marca, data.modelo, 'disponível', data.timestamp]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// 2. AGENDAR IMPRESIÓN
app.post('/api/registos/schedule', async (req, res) => {
    try {
        const data = req.body;
        const sql = `INSERT INTO agendamentos (registo_id, printer_id, order_id, title, start, end, color, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        await pool.execute(sql, [data.id, data.printer_id, data.order_id, data.title, data.start, data.end, data.color, data.notes]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// 3. REPORTAR INCIDENTE (AJUSTE AUTOMÁTICO DE HORARIO)
app.post('/api/agendamentos/atraso', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const { id, minutos, printer_id } = req.body;
        
        // Obtener evento original
        const [rows] = await connection.execute("SELECT * FROM agendamentos WHERE registo_id = ?", [id]);
        if(rows.length === 0) throw new Error("Evento no encontrado");
        const eventoOrigen = rows[0];

        // Empujar todos los eventos futuros en esa impresora
        const sqlUpdate = `
            UPDATE agendamentos 
            SET start = DATE_ADD(start, INTERVAL ? MINUTE), 
                end = DATE_ADD(end, INTERVAL ? MINUTE)
            WHERE printer_id = ? AND start >= ? AND status != 'concluido'
        `;
        
        await connection.execute(sqlUpdate, [minutos, minutos, printer_id, eventoOrigen.start]);
        await connection.commit();
        res.json({ success: true, message: "Horário ajustado automaticamente" });
    } catch (e) {
        await connection.rollback();
        res.status(500).json({ success: false, message: e.message });
    } finally {
        connection.release();
    }
});

// ==================== RUTAS CRUD ESTÁNDAR (MANTENIDAS) ====================

app.post('/api/registos/supplier', async (req, res) => {
  try {
    const { id, registo_id, supplierName, name, supplierEmail, email, supplierPhone, phone, supplierAddress, address, timestamp } = req.body;
    const finalID = id || registo_id; 
    const finalName = supplierName || name; 
    const sql = `INSERT INTO fornecedores (registo_id, supplierName, supplierEmail, supplierPhone, supplierAddress, timestamp) VALUES (?, ?, ?, ?, ?, ?)`;
    const [result] = await pool.execute(sql, [finalID, finalName, supplierEmail || email, supplierPhone || phone, supplierAddress || address, timestamp]);
    res.json({ success: true, backendId: result.insertId });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.post('/api/registos/filament', async (req, res) => {
  try {
    const data = req.body;
    const sql = `INSERT INTO filamentos (registo_id, barcode, name, material, color, weightPerUnit, pricePerUnit, minStock, supplier, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await pool.execute(sql, [data.id, data.barcode, data.name, data.material, data.color, parseFloat(data.weightPerUnit), parseFloat(data.pricePerUnit), parseFloat(data.minStock), data.supplier, data.timestamp]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.post('/api/registos/product', async (req, res) => {
  try {
    const data = req.body;
    const sql = `INSERT INTO produtos (registo_id, barcode, name, productCategory, stock, cost, salePrice, composition, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await pool.execute(sql, [data.id, data.barcode, data.name, data.productCategory, parseInt(data.stock), parseFloat(data.cost), parseFloat(data.salePrice), JSON.stringify(data.composition || []), data.timestamp]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.post('/api/registos/purchase', async (req, res) => {
  try {
    const data = req.body;
    const category = data.category || 'filament'; 
    const sqlInsert = `INSERT INTO entradas (registo_id, filamentBarcode, quantityPurchased, purchaseDate, supplier, timestamp) VALUES (?, ?, ?, ?, ?, ?)`;
    await pool.execute(sqlInsert, [data.id, data.barcode || data.filamentBarcode, parseFloat(data.quantityPurchased), data.purchaseDate, data.supplier, data.timestamp]);
    if (category === 'product') {
        await pool.execute(`UPDATE produtos SET stock = stock + ? WHERE barcode = ?`, [parseFloat(data.quantityPurchased), data.barcode || data.filamentBarcode]);
    }
    res.json({ success: true });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.post('/api/registos/print', async (req, res) => {
  try {
    const data = req.body;
    const sql = `INSERT INTO impressoes (registo_id, printName, filamentsUsed, notes, timestamp) VALUES (?, ?, ?, ?, ?)`;
    await pool.execute(sql, [data.id, data.printName, JSON.stringify(data.filamentsUsed || []), data.notes, data.timestamp]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.post('/api/registos/sale', async (req, res) => {
  try {
    const data = req.body;
    const sqlVenda = `INSERT INTO vendas (registo_id, productBarcode, quantitySold, totalPrice, saleDate, timestamp) VALUES (?, ?, ?, ?, ?, ?)`;
    await pool.execute(sqlVenda, [data.id, data.productBarcode, data.quantitySold, data.totalPrice, data.saleDate, data.timestamp]);
    await pool.execute(`UPDATE produtos SET stock = stock - ? WHERE barcode = ?`, [data.quantitySold, data.productBarcode]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.post('/api/registos/order', async (req, res) => {
    try {
        const data = req.body;
        const sql = `INSERT INTO pedidos (registo_id, clientName, productBarcode, quantity, dueDate, status, orderType, composition, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        await pool.execute(sql, [data.id, data.clientName, data.productBarcode || null, data.quantity, data.dueDate, 'pendente', data.orderType || 'standard', JSON.stringify(data.composition || []), data.timestamp]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ==================== LISTAR TUDO (GET) ====================
app.get('/api/registos', async (req, res) => {
  try {
    let allRecords = [];

    const [filaments] = await pool.execute('SELECT * FROM filamentos');
    allRecords = allRecords.concat(filaments.map(f => ({ ...f, id: f.registo_id, type: 'filament', weightPerUnit: parseFloat(f.weightPerUnit), pricePerUnit: parseFloat(f.pricePerUnit), minStock: parseFloat(f.minStock) })));

    const [suppliers] = await pool.execute('SELECT * FROM fornecedores');
    allRecords = allRecords.concat(suppliers.map(s => ({ ...s, id: s.registo_id, type: 'supplier' })));

    const [products] = await pool.execute('SELECT * FROM produtos');
    allRecords = allRecords.concat(products.map(p => ({ ...p, id: p.registo_id, type: 'product', composition: JSON.parse(p.composition || '[]') })));

    const [purchases] = await pool.execute('SELECT * FROM entradas');
    allRecords = allRecords.concat(purchases.map(p => ({ ...p, id: p.registo_id, type: 'purchase' })));

    const [prints] = await pool.execute('SELECT * FROM impressoes');
    allRecords = allRecords.concat(prints.map(p => ({ ...p, id: p.registo_id, type: 'print', filamentsUsed: JSON.parse(p.filamentsUsed || '[]') })));

    const [sales] = await pool.execute('SELECT * FROM vendas');
    allRecords = allRecords.concat(sales.map(s => ({ ...s, id: s.registo_id, type: 'sale' })));

    const [orders] = await pool.execute('SELECT * FROM pedidos');
    allRecords = allRecords.concat(orders.map(o => ({ ...o, id: o.registo_id, type: 'order', composition: JSON.parse(o.composition || '[]') })));

    // ✅ INCLUIR MÁQUINAS Y AGENDA
    const [maquinas] = await pool.execute('SELECT * FROM maquinas');
    allRecords = allRecords.concat(maquinas.map(m => ({ ...m, id: m.registo_id, type: 'machine' })));

    const [agenda] = await pool.execute('SELECT * FROM agendamentos');
    allRecords = allRecords.concat(agenda.map(a => ({ ...a, id: a.registo_id, type: 'schedule' })));

    res.json({ success: true, data: allRecords });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false });
  }
});

// ELIMINAR
app.delete('/api/registos/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        let table = '';
        switch(type) {
            case 'filament': table = 'filamentos'; break;
            case 'supplier': table = 'fornecedores'; break;
            case 'product': table = 'produtos'; break;
            case 'purchase': table = 'entradas'; break;
            case 'print': table = 'impressoes'; break;
            case 'sale': table = 'vendas'; break;
            case 'order': table = 'pedidos'; break;
            case 'machine': table = 'maquinas'; break; // Nuevo
            case 'schedule': table = 'agendamentos'; break; // Nuevo
            default: return res.status(400).json({success: false});
        }
        const sql = `DELETE FROM ${table} WHERE registo_id = ? OR id = ?`;
        await pool.execute(sql, [id, id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// ACTUALIZACIONES (PUT) - Mantenemos las existentes y agregamos status orden
app.put('/api/registos/order/:id/status', async (req, res) => {
    try {
        const { id } = req.params; const { status } = req.body;
        await pool.execute("UPDATE pedidos SET status = ? WHERE registo_id = ? OR id = ?", [status, id, id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ... [Aquí irían el resto de PUTs para editar filamentos, productos, etc. si se usan, mantenlos del backup original] ...
// Para mantener el código limpio, asumo que usas el mismo patrón.

async function startServer() {
  await initDatabase();
  app.listen(PORT, () => console.log(`🚀 Porta ${PORT}`));
}
startServer();
