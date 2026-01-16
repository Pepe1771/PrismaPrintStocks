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

// ✅ CONFIGURACIÓN SEGURA DE BASE DE DATOS
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

    // 1. TABLA PEDIDOS (Si no existe, la crea)
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
    
    // 2. MIGRACIONES (Añadir columnas nuevas si faltan)
    try {
        await connection.execute("ALTER TABLE produtos ADD COLUMN composition LONGTEXT");
        console.log("Columna 'composition' añadida a produtos");
    } catch (e) { /* Ignorar si ya existe */ }

    try {
        await connection.execute("ALTER TABLE pedidos ADD COLUMN orderType VARCHAR(20) DEFAULT 'standard'");
        await connection.execute("ALTER TABLE pedidos ADD COLUMN composition LONGTEXT");
        console.log("Columnas añadidas a pedidos");
    } catch (e) { /* Ignorar si ya existe */ }

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

// ==================== ROTAS (CRUD) ====================

// 1. FORNECEDORES
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

// 2. FILAMENTOS
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

// 3. PRODUTOS (CON RECETA)
app.post('/api/registos/product', async (req, res) => {
  try {
    const data = req.body;
    const compositionStr = JSON.stringify(data.composition || []); 

    const sql = `INSERT INTO produtos (registo_id, barcode, name, productCategory, stock, cost, salePrice, composition, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await pool.execute(sql, [
      data.id || data.registo_id, data.barcode, data.name, data.productCategory, 
      parseInt(data.stock), parseFloat(data.cost), parseFloat(data.salePrice), 
      compositionStr,
      data.timestamp
    ]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 4. ENTRADAS
app.post('/api/registos/purchase', async (req, res) => {
  try {
    const data = req.body;
    const category = data.category || 'filament'; 

    const sqlInsert = `INSERT INTO entradas (registo_id, filamentBarcode, quantityPurchased, purchaseDate, supplier, timestamp) VALUES (?, ?, ?, ?, ?, ?)`;
    
    await pool.execute(sqlInsert, [
      data.id || data.registo_id, 
      data.barcode || data.filamentBarcode,
      parseFloat(data.quantityPurchased), 
      data.purchaseDate, 
      data.supplier, 
      data.timestamp
    ]);

    if (category === 'product') {
        const sqlUpdateStock = `UPDATE produtos SET stock = stock + ? WHERE barcode = ?`;
        await pool.execute(sqlUpdateStock, [parseFloat(data.quantityPurchased), data.barcode || data.filamentBarcode]);
    }

    res.json({ success: true, message: 'Entrada registada' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 5. IMPRESSÕES
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

// 6. VENDAS
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

// 7. PEDIDOS (SOPORTE PARA CUSTOM Y STANDARD)
app.post('/api/registos/order', async (req, res) => {
    try {
        const data = req.body;
        const compositionStr = JSON.stringify(data.composition || []);
        const orderType = data.orderType || 'standard';
        
        // CORRECCIÓN: Si no hay código de barras (pedido custom), enviamos NULL
        const productBarcode = data.productBarcode || null; 

        const sql = `INSERT INTO pedidos (registo_id, clientName, productBarcode, quantity, dueDate, status, orderType, composition, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        
        await pool.execute(sql, [
            data.id, 
            data.clientName, 
            productBarcode, // <--- Aquí estaba el error (antes era data.productBarcode)
            data.quantity, 
            data.dueDate, 
            'pendente', 
            orderType, 
            compositionStr, 
            data.timestamp
        ]);
        
        res.json({ success: true });
    } catch (e) {
        console.error("Error al crear pedido:", e); // Añadí un log para que veas el error en la consola de Render si vuelve a pasar
        res.status(500).json({ success: false, message: e.message });
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

    // Parseamos JSON composition
    const [products] = await pool.execute('SELECT * FROM produtos');
    allRecords = allRecords.concat(products.map(p => ({ 
        ...p, 
        id: p.registo_id, 
        type: 'product', 
        stock: parseInt(p.stock), 
        salePrice: parseFloat(p.salePrice), 
        cost: parseFloat(p.cost),
        composition: JSON.parse(p.composition || '[]')
    })));

    const [purchases] = await pool.execute('SELECT * FROM entradas');
    allRecords = allRecords.concat(purchases.map(p => ({ ...p, id: p.registo_id, type: 'purchase', quantityPurchased: parseFloat(p.quantityPurchased) })));

    const [prints] = await pool.execute('SELECT * FROM impressoes');
    allRecords = allRecords.concat(prints.map(p => ({ ...p, id: p.registo_id, type: 'print', filamentsUsed: JSON.parse(p.filamentsUsed || '[]') })));

    const [sales] = await pool.execute('SELECT * FROM vendas');
    allRecords = allRecords.concat(sales.map(s => ({ ...s, id: s.registo_id, type: 'sale', quantitySold: parseInt(s.quantitySold), totalPrice: parseFloat(s.totalPrice) })));

    // Parseamos JSON composition y orderType
    const [orders] = await pool.execute('SELECT * FROM pedidos');
    allRecords = allRecords.concat(orders.map(o => ({ 
        ...o, 
        id: o.registo_id, 
        type: 'order', 
        quantity: parseInt(o.quantity),
        composition: JSON.parse(o.composition || '[]') 
    })));

    res.json({ success: true, data: allRecords });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false });
  }
});

// 8. ELIMINAR
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
            default: return res.status(400).json({success: false});
        }
        const sql = `DELETE FROM ${table} WHERE registo_id = ? OR id = ?`;
        await pool.execute(sql, [id, id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 9. COMPLETAR PEDIDO
app.put('/api/registos/order/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        await pool.execute("UPDATE pedidos SET status = ? WHERE registo_id = ? OR id = ?", [status, id, id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// ==================== ATUALIZAR (PUT) ====================

app.put('/api/registos/filament/:id', async (req, res) => {
  try {
    const { id } = req.params; const data = req.body;
    const sql = `UPDATE filamentos SET barcode = ?, name = ?, material = ?, color = ?, weightPerUnit = ?, pricePerUnit = ?, minStock = ?, supplier = ? WHERE registo_id = ? OR id = ?`;
    await pool.execute(sql, [data.barcode, data.name, data.material, data.color, parseFloat(data.weightPerUnit), parseFloat(data.pricePerUnit), parseFloat(data.minStock), data.supplier, id, id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.put('/api/registos/product/:id', async (req, res) => {
  try {
    const { id } = req.params; const data = req.body;
    const compositionStr = JSON.stringify(data.composition || []);
    const sql = `UPDATE produtos SET barcode = ?, name = ?, productCategory = ?, stock = ?, cost = ?, salePrice = ?, composition = ? WHERE registo_id = ? OR id = ?`;
    await pool.execute(sql, [data.barcode, data.name, data.productCategory, parseInt(data.stock), parseFloat(data.cost), parseFloat(data.salePrice), compositionStr, id, id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.put('/api/registos/supplier/:id', async (req, res) => {
  try {
    const { id } = req.params; const data = req.body;
    const sql = `UPDATE fornecedores SET supplierName = ?, supplierEmail = ?, supplierPhone = ?, supplierAddress = ? WHERE registo_id = ? OR id = ?`;
    await pool.execute(sql, [data.supplierName, data.supplierEmail, data.supplierPhone, data.supplierAddress, id, id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.put('/api/registos/purchase/:id', async (req, res) => {
  try {
    const { id } = req.params; const data = req.body;
    const sql = `UPDATE entradas SET filamentBarcode = ?, quantityPurchased = ?, purchaseDate = ?, supplier = ? WHERE registo_id = ? OR id = ?`;
    await pool.execute(sql, [data.filamentBarcode, parseFloat(data.quantityPurchased), data.purchaseDate, data.supplier, id, id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.put('/api/registos/print/:id', async (req, res) => {
  try {
    const { id } = req.params; const data = req.body;
    const filamentsString = JSON.stringify(data.filamentsUsed || []);
    const sql = `UPDATE impressoes SET printName = ?, filamentsUsed = ?, notes = ? WHERE registo_id = ? OR id = ?`;
    await pool.execute(sql, [data.printName, filamentsString, data.notes, id, id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.put('/api/registos/sale/:id', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { id } = req.params; const data = req.body;
    const [oldSaleRows] = await connection.execute('SELECT * FROM vendas WHERE registo_id = ? OR id = ?', [id, id]);
    if (oldSaleRows.length === 0) throw new Error('Venda não encontrada');
    const oldSale = oldSaleRows[0];
    await connection.execute('UPDATE produtos SET stock = stock + ? WHERE barcode = ?', [oldSale.quantitySold, oldSale.productBarcode]);
    await connection.execute('UPDATE vendas SET productBarcode = ?, quantitySold = ?, totalPrice = ?, saleDate = ? WHERE registo_id = ? OR id = ?', [data.productBarcode, data.quantitySold, data.totalPrice, data.saleDate, id, id]);
    await connection.execute('UPDATE produtos SET stock = stock - ? WHERE barcode = ?', [data.quantitySold, data.productBarcode]);
    await connection.commit();
    res.json({ success: true, message: 'Venda e stock atualizados' });
  } catch (error) { await connection.rollback(); res.status(500).json({ success: false, message: error.message }); } 
  finally { connection.release(); }
});

async function startServer() {
  await initDatabase();
  app.listen(PORT, () => console.log(`🚀 Porta ${PORT}`));
}
startServer();
