const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// ==================== CONFIGURAÇÃO ====================
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Configuração de conexão MySQL
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
    console.log('✅ Conexão com MySQL estabelecida com sucesso');
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
  } catch (error) {
    console.error('❌ Erro ao conectar ao MySQL:', error.message);
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
      res.status(401).json({ success: false, message: 'Credenciais inválidas' });
    }
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ==================== ROTAS (CRUD) ====================

// 1. FORNECEDORES (CREATE)
app.post('/api/registos/supplier', async (req, res) => {
  try {
    const { id, registo_id, supplierName, name, supplierEmail, email, supplierPhone, phone, supplierAddress, address, timestamp } = req.body;
    const finalID = id || registo_id; 
    const finalName = supplierName || name; 
    const finalEmail = supplierEmail || email;
    const finalPhone = supplierPhone || phone;
    const finalAddress = supplierAddress || address;

    const sql = `INSERT INTO fornecedores (registo_id, supplierName, supplierEmail, supplierPhone, supplierAddress, timestamp) VALUES (?, ?, ?, ?, ?, ?)`;
    const [result] = await pool.execute(sql, [finalID, finalName, finalEmail, finalPhone, finalAddress, timestamp]);
    res.json({ success: true, backendId: result.insertId });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. FILAMENTOS (CREATE)
app.post('/api/registos/filament', async (req, res) => {
  try {
    const data = req.body;
    const sql = `INSERT INTO filamentos (registo_id, barcode, name, material, color, weightPerUnit, pricePerUnit, minStock, supplier, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await pool.execute(sql, [
      data.id || data.registo_id, data.barcode, data.name, data.material, data.color, parseFloat(data.weightPerUnit), parseFloat(data.pricePerUnit), parseFloat(data.minStock), data.supplier, data.timestamp
    ]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. PRODUTOS (CREATE)
app.post('/api/registos/product', async (req, res) => {
  try {
    const data = req.body;
    const sql = `INSERT INTO produtos (registo_id, barcode, name, productCategory, stock, cost, salePrice, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    await pool.execute(sql, [
      data.id || data.registo_id, data.barcode, data.name, data.productCategory, data.stock, data.cost, data.salePrice, data.timestamp
    ]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// 4. ENTRADAS (CREATE)
app.post('/api/registos/purchase', async (req, res) => {
  try {
    const data = req.body;
    const sql = `INSERT INTO entradas (registo_id, filamentBarcode, quantityPurchased, purchaseDate, supplier, timestamp) VALUES (?, ?, ?, ?, ?, ?)`;
    await pool.execute(sql, [
      data.id || data.registo_id, data.filamentBarcode, parseFloat(data.quantityPurchased), data.purchaseDate, data.supplier, data.timestamp
    ]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 5. IMPRESSÕES (CREATE)
app.post('/api/registos/print', async (req, res) => {
  try {
    const data = req.body;
    const filamentsString = JSON.stringify(data.filamentsUsed || []);
    const sql = `INSERT INTO impressoes (registo_id, printName, filamentsUsed, notes, timestamp) VALUES (?, ?, ?, ?, ?)`;
    await pool.execute(sql, [
      data.id || data.registo_id, data.printName, filamentsString, data.notes, data.timestamp
    ]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 6. VENDAS (CREATE)
app.post('/api/registos/sale', async (req, res) => {
  try {
    const data = req.body;
    const sqlVenda = `INSERT INTO vendas (registo_id, productBarcode, quantitySold, totalPrice, saleDate, timestamp) VALUES (?, ?, ?, ?, ?, ?)`;
    await pool.execute(sqlVenda, [
      data.id || data.registo_id, data.productBarcode, data.quantitySold, data.totalPrice, data.saleDate, data.timestamp
    ]);
    const sqlUpdateStock = `UPDATE produtos SET stock = stock - ? WHERE barcode = ?`;
    await pool.execute(sqlUpdateStock, [data.quantitySold, data.productBarcode]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== LISTAR TUDO (GET) ====================
app.get('/api/registos', async (req, res) => {
  try {
    let allRecords = [];
    const [filaments] = await pool.execute('SELECT * FROM filamentos');
    allRecords = allRecords.concat(filaments.map(f => ({ ...f, id: f.registo_id, type: 'filament', weightPerUnit: parseFloat(f.weightPerUnit), pricePerUnit: parseFloat(f.pricePerUnit), minStock: parseFloat(f.minStock) })));

    const [suppliers] = await pool.execute('SELECT * FROM fornecedores');
    allRecords = allRecords.concat(suppliers.map(s => ({ ...s, id: s.registo_id, type: 'supplier', supplierName: s.supplierName })));

    const [products] = await pool.execute('SELECT * FROM produtos');
    allRecords = allRecords.concat(products.map(p => ({ ...p, id: p.registo_id, type: 'product', stock: parseInt(p.stock), salePrice: parseFloat(p.salePrice), cost: parseFloat(p.cost) })));

    const [purchases] = await pool.execute('SELECT * FROM entradas');
    allRecords = allRecords.concat(purchases.map(p => ({ ...p, id: p.registo_id, type: 'purchase', quantityPurchased: parseFloat(p.quantityPurchased) })));

    const [prints] = await pool.execute('SELECT * FROM impressoes');
    allRecords = allRecords.concat(prints.map(p => ({ ...p, id: p.registo_id, type: 'print', filamentsUsed: JSON.parse(p.filamentsUsed || '[]') })));

    const [sales] = await pool.execute('SELECT * FROM vendas');
    allRecords = allRecords.concat(sales.map(s => ({ ...s, id: s.registo_id, type: 'sale', quantitySold: parseInt(s.quantitySold), totalPrice: parseFloat(s.totalPrice) })));

    res.json({ success: true, data: allRecords });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// 7. ELIMINAR (DELETE)
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
            default: return res.status(400).json({success: false});
        }
        const sql = `DELETE FROM ${table} WHERE registo_id = ? OR id = ?`;
        await pool.execute(sql, [id, id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== ATUALIZAR (PUT) ====================

// 8. FILAMENTOS (Edit)
app.put('/api/registos/filament/:id', async (req, res) => {
  try {
    const { id } = req.params; 
    const data = req.body;
    const sql = `UPDATE filamentos SET barcode = ?, name = ?, material = ?, color = ?, weightPerUnit = ?, pricePerUnit = ?, minStock = ?, supplier = ? WHERE registo_id = ? OR id = ?`;

    await pool.execute(sql, [
      data.barcode, data.name, data.material, data.color, parseFloat(data.weightPerUnit), parseFloat(data.pricePerUnit), parseFloat(data.minStock), data.supplier, id, id
    ]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 9. PRODUTOS (Edit)
app.put('/api/registos/product/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const sql = `UPDATE produtos SET barcode = ?, name = ?, productCategory = ?, stock = ?, cost = ?, salePrice = ? WHERE registo_id = ? OR id = ?`;
    
    await pool.execute(sql, [
      data.barcode, data.name, data.productCategory, parseInt(data.stock), parseFloat(data.cost), parseFloat(data.salePrice), id, id
    ]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 10. FORNECEDORES (Edit)
app.put('/api/registos/supplier/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const sql = `UPDATE fornecedores SET supplierName = ?, supplierEmail = ?, supplierPhone = ?, supplierAddress = ? WHERE registo_id = ? OR id = ?`;
    await pool.execute(sql, [data.supplierName, data.supplierEmail, data.supplierPhone, data.supplierAddress, id, id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 11. ENTRADAS (Edit) - NUEVO
app.put('/api/registos/purchase/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const sql = `UPDATE entradas SET filamentBarcode = ?, quantityPurchased = ?, purchaseDate = ?, supplier = ? WHERE registo_id = ? OR id = ?`;
    
    await pool.execute(sql, [
      data.filamentBarcode, parseFloat(data.quantityPurchased), data.purchaseDate, data.supplier, id, id
    ]);
    res.json({ success: true, message: 'Entrada atualizada' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


async function startServer() {
  await initDatabase();
  app.listen(PORT, () => console.log(`🚀 Porta ${PORT}`));
}
startServer();
