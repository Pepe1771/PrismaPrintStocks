const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); // Serve o frontend se estiver na pasta public

// ==========================================
// 1. CONFIGURAÇÃO DA BASE DE DADOS
// ==========================================
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'gestor_stock_3d',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: true // Importante para datas virem como strings (YYYY-MM-DD)
};

let pool;

async function initDatabase() {
    try {
        pool = mysql.createPool(dbConfig);
        console.log('✅ MySQL Conectado');
        
        const connection = await pool.getConnection();

        // Tabelas Base
        await connection.execute(`CREATE TABLE IF NOT EXISTS utilizadores (id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(50), password VARCHAR(50), role VARCHAR(20))`);
        
        // Inserir Admin padrão se não existir
        const [users] = await connection.execute("SELECT * FROM utilizadores");
        if(users.length === 0) {
            await connection.execute("INSERT INTO utilizadores (username, password, role) VALUES ('admin', 'admin123', 'admin')");
            console.log("👤 Utilizador 'admin' criado (pass: admin123)");
        }

        // Tabela Filamentos
        await connection.execute(`CREATE TABLE IF NOT EXISTS filamentos (
            id INT AUTO_INCREMENT PRIMARY KEY, registo_id VARCHAR(50), barcode VARCHAR(100), name VARCHAR(100), 
            material VARCHAR(50), color VARCHAR(50), weightPerUnit DECIMAL(10,3), pricePerUnit DECIMAL(10,2), 
            minStock DECIMAL(10,3), supplier VARCHAR(100), timestamp VARCHAR(50)
        )`);

        // Tabela Produtos
        await connection.execute(`CREATE TABLE IF NOT EXISTS produtos (
            id INT AUTO_INCREMENT PRIMARY KEY, registo_id VARCHAR(50), barcode VARCHAR(100), name VARCHAR(100), 
            productCategory VARCHAR(50), stock INT, cost DECIMAL(10,2), salePrice DECIMAL(10,2), 
            composition LONGTEXT, timestamp VARCHAR(50)
        )`);

        // Tabela Fornecedores
        await connection.execute(`CREATE TABLE IF NOT EXISTS fornecedores (
            id INT AUTO_INCREMENT PRIMARY KEY, registo_id VARCHAR(50), supplierName VARCHAR(100), 
            supplierEmail VARCHAR(100), supplierPhone VARCHAR(50), supplierAddress VARCHAR(255), timestamp VARCHAR(50)
        )`);

        // Tabela Entradas
        await connection.execute(`CREATE TABLE IF NOT EXISTS entradas (
            id INT AUTO_INCREMENT PRIMARY KEY, registo_id VARCHAR(50), filamentBarcode VARCHAR(100), 
            quantityPurchased DECIMAL(10,3), purchaseDate DATE, supplier VARCHAR(100), timestamp VARCHAR(50)
        )`);

        // Tabela Vendas
        await connection.execute(`CREATE TABLE IF NOT EXISTS vendas (
            id INT AUTO_INCREMENT PRIMARY KEY, registo_id VARCHAR(50), productBarcode VARCHAR(100), 
            quantitySold INT, totalPrice DECIMAL(10,2), saleDate DATE, timestamp VARCHAR(50)
        )`);

        // Tabela Impressões
        await connection.execute(`CREATE TABLE IF NOT EXISTS impressoes (
            id INT AUTO_INCREMENT PRIMARY KEY, registo_id VARCHAR(50), printName VARCHAR(100), 
            filamentsUsed LONGTEXT, notes TEXT, timestamp VARCHAR(50)
        )`);

        // Tabela Encomendas (Pedidos)
        await connection.execute(`CREATE TABLE IF NOT EXISTS pedidos (
            id INT AUTO_INCREMENT PRIMARY KEY, registo_id VARCHAR(50), clientName VARCHAR(100), 
            productBarcode VARCHAR(100), quantity INT, dueDate DATE, status VARCHAR(20) DEFAULT 'pendente', 
            orderType VARCHAR(20) DEFAULT 'standard', composition LONGTEXT, timestamp VARCHAR(50)
        )`);

        // --- NOVAS TABELAS PARA FUNCIONALIDADES DO APP.JS ---

        // Tabela Máquinas
        await connection.execute(`CREATE TABLE IF NOT EXISTS maquinas (
            id INT AUTO_INCREMENT PRIMARY KEY, registo_id VARCHAR(50), 
            nome VARCHAR(100), marca VARCHAR(100), modelo VARCHAR(100), timestamp VARCHAR(50)
        )`);

        // Tabela Agendamentos (Calendário)
        await connection.execute(`CREATE TABLE IF NOT EXISTS agendamentos (
            id INT AUTO_INCREMENT PRIMARY KEY, registo_id VARCHAR(50), printer_id VARCHAR(50), 
            order_id VARCHAR(50), title VARCHAR(100), start DATETIME, end DATETIME, 
            notes TEXT, color VARCHAR(20), status VARCHAR(20) DEFAULT 'agendado', timestamp VARCHAR(50)
        )`);

        connection.release();
        console.log('✅ Base de dados inicializada com sucesso.');
    } catch (error) {
        console.error('❌ Erro Conexão DB:', error.message);
    }
}

// ==========================================
// 2. ROTAS DE AUTENTICAÇÃO
// ==========================================
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const [rows] = await pool.execute('SELECT * FROM utilizadores WHERE username = ? AND password = ?', [username, password]);
        if (rows.length > 0) res.json({ success: true, user: { username: rows[0].username, role: rows[0].role } });
        else res.status(401).json({ success: false, message: 'Login falhou' });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ==========================================
// 3. ROTA GET (CARREGAR TUDO)
// ==========================================
app.get('/api/registos', async (req, res) => {
    try {
        let allData = [];
        
        // Funções auxiliares de query
        const getTable = async (table, type, extraMap = data => data) => {
            const [rows] = await pool.execute(`SELECT * FROM ${table}`);
            return rows.map(r => ({ ...r, id: r.registo_id, type, ...extraMap(r) }));
        };

        const filamentos = await getTable('filamentos', 'filament', r => ({
            weightPerUnit: parseFloat(r.weightPerUnit), pricePerUnit: parseFloat(r.pricePerUnit), minStock: parseFloat(r.minStock)
        }));
        
        const produtos = await getTable('produtos', 'product', r => ({
            stock: parseInt(r.stock), salePrice: parseFloat(r.salePrice), cost: parseFloat(r.cost), composition: JSON.parse(r.composition || '[]')
        }));

        const fornecedores = await getTable('fornecedores', 'supplier');
        const entradas = await getTable('entradas', 'purchase', r => ({ quantityPurchased: parseFloat(r.quantityPurchased) }));
        const impressoes = await getTable('impressoes', 'print', r => ({ filamentsUsed: JSON.parse(r.filamentsUsed || '[]') }));
        const vendas = await getTable('vendas', 'sale', r => ({ quantitySold: parseInt(r.quantitySold), totalPrice: parseFloat(r.totalPrice) }));
        const pedidos = await getTable('pedidos', 'order', r => ({ quantity: parseInt(r.quantity), composition: JSON.parse(r.composition || '[]') }));
        
        // Novas tabelas
        const maquinas = await getTable('maquinas', 'machine');
        const agendamentos = await getTable('agendamentos', 'schedule');

        allData = [...filamentos, ...produtos, ...fornecedores, ...entradas, ...impressoes, ...vendas, ...pedidos, ...maquinas, ...agendamentos];
        
        res.json({ success: true, data: allData });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// 4. ROTA POST (CRIAÇÃO UNIVERSAL)
// ==========================================
app.post('/api/registos/:type', async (req, res) => {
    const { type } = req.params;
    const data = req.body;
    const id = data.id || data.registo_id; // Usa ID do frontend
    const ts = data.timestamp || new Date().toISOString();

    try {
        let sql = '';
        let params = [];

        switch(type) {
            case 'filament':
                sql = `INSERT INTO filamentos (registo_id, barcode, name, material, color, weightPerUnit, pricePerUnit, minStock, supplier, timestamp) VALUES (?,?,?,?,?,?,?,?,?,?)`;
                params = [id, data.barcode, data.name, data.material, data.color, data.weightPerUnit, data.pricePerUnit, data.minStock, data.supplier, ts];
                break;
            
            case 'product':
                sql = `INSERT INTO produtos (registo_id, barcode, name, productCategory, stock, cost, salePrice, composition, timestamp) VALUES (?,?,?,?,?,?,?,?,?)`;
                params = [id, data.barcode, data.name, data.productCategory, data.stock, data.cost, data.salePrice, JSON.stringify(data.composition || []), ts];
                break;

            case 'supplier':
                sql = `INSERT INTO fornecedores (registo_id, supplierName, supplierEmail, supplierPhone, supplierAddress, timestamp) VALUES (?,?,?,?,?,?)`;
                params = [id, data.supplierName, data.supplierEmail, data.supplierPhone, data.supplierAddress, ts];
                break;

            case 'purchase':
                sql = `INSERT INTO entradas (registo_id, filamentBarcode, quantityPurchased, purchaseDate, supplier, timestamp) VALUES (?,?,?,?,?,?)`;
                params = [id, data.barcode || data.filamentBarcode, data.quantityPurchased, data.purchaseDate, data.supplier, ts];
                // Atualizar stock do produto (se for produto) ou lógica de filamento é calculada dinamicamente
                if (data.category === 'product') {
                    await pool.execute('UPDATE produtos SET stock = stock + ? WHERE barcode = ?', [data.quantityPurchased, data.barcode]);
                }
                break;

            case 'print':
                sql = `INSERT INTO impressoes (registo_id, printName, filamentsUsed, notes, timestamp) VALUES (?,?,?,?,?)`;
                params = [id, data.printName, JSON.stringify(data.filamentsUsed || []), data.notes, ts];
                break;

            case 'sale':
                sql = `INSERT INTO vendas (registo_id, productBarcode, quantitySold, totalPrice, saleDate, timestamp) VALUES (?,?,?,?,?,?)`;
                params = [id, data.productBarcode, data.quantitySold, data.totalPrice, data.saleDate, ts];
                // Atualizar Stock
                await pool.execute('UPDATE produtos SET stock = stock - ? WHERE barcode = ?', [data.quantitySold, data.productBarcode]);
                break;

            case 'order':
                sql = `INSERT INTO pedidos (registo_id, clientName, productBarcode, quantity, dueDate, status, orderType, composition, timestamp) VALUES (?,?,?,?,?,?,?,?,?)`;
                params = [id, data.clientName, data.productBarcode || '', data.quantity, data.dueDate, 'pendente', data.orderType || 'standard', JSON.stringify(data.composition || []), ts];
                break;

            case 'machine':
                sql = `INSERT INTO maquinas (registo_id, nome, marca, modelo, timestamp) VALUES (?,?,?,?,?)`;
                params = [id, data.nome, data.marca, data.modelo, ts];
                break;

            case 'schedule':
                sql = `INSERT INTO agendamentos (registo_id, printer_id, order_id, title, start, end, notes, color, status, timestamp) VALUES (?,?,?,?,?,?,?,?,?,?)`;
                params = [id, data.printer_id, data.order_id || null, data.title, data.start, data.end, data.notes, data.color, 'agendado', ts];
                break;

            default:
                return res.status(400).json({ success: false, message: 'Tipo desconhecido' });
        }

        await pool.execute(sql, params);
        res.json({ success: true, id: id });

    } catch (e) {
        console.error("Erro insert:", e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==========================================
// 5. ROTA PUT (ATUALIZAÇÃO)
// ==========================================
app.put('/api/registos/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    const data = req.body;

    try {
        let sql = '';
        let params = [];

        switch(type) {
            case 'filament':
                sql = "UPDATE filamentos SET barcode=?, name=?, material=?, color=?, weightPerUnit=?, pricePerUnit=?, minStock=?, supplier=? WHERE registo_id=?";
                params = [data.barcode, data.name, data.material, data.color, data.weightPerUnit, data.pricePerUnit, data.minStock, data.supplier, id];
                break;
            case 'product':
                sql = "UPDATE produtos SET barcode=?, name=?, productCategory=?, stock=?, cost=?, salePrice=?, composition=? WHERE registo_id=?";
                params = [data.barcode, data.name, data.productCategory, data.stock, data.cost, data.salePrice, JSON.stringify(data.composition), id];
                break;
            case 'order':
                 // Caso especial para atualizar apenas status
                if(data.statusOnly) {
                    sql = "UPDATE pedidos SET status=? WHERE registo_id=?";
                    params = [data.status, id];
                } else {
                    // Update completo (implementar se necessário)
                    sql = "UPDATE pedidos SET status=? WHERE registo_id=?";
                    params = [data.status, id];
                }
                break;
            // Adicionar outros tipos conforme necessário
        }

        if(sql) {
            await pool.execute(sql, params);
            res.json({ success: true });
        } else {
            res.json({ success: false, message: "Update não implementado para este tipo" });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Endpoint Específico para Status de Encomenda
app.put('/api/registos/order/:id/status', async (req, res) => {
    try {
        await pool.execute('UPDATE pedidos SET status = ? WHERE registo_id = ?', [req.body.status, req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false }); }
});

// ==========================================
// 6. ROTA DELETE (ELIMINAR) - CORREGIDO
// ==========================================
app.delete('/api/registos/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    let table = '';
    
    switch(type) {
        case 'filament': table = 'filamentos'; break;
        case 'product': table = 'produtos'; break; // Atención: tabla 'produtos' (portugués) o 'productos'? Revisa tu DB.
        case 'supplier': table = 'fornecedores'; break;
        case 'purchase': table = 'entradas'; break;
        case 'print': table = 'impressoes'; break;
        case 'sale': table = 'vendas'; break;
        case 'order': table = 'pedidos'; break;
        case 'machine': table = 'maquinas'; break;
        case 'schedule': table = 'agendamentos'; break;
    }

    // Si tu tabla de productos se llama 'productos' en español en la DB, descomenta esto:
    // if (type === 'product') table = 'productos'; 

    if (!table) return res.status(400).json({ success: false });

    try {
        // CORRECCIÓN AQUÍ: Borrar por registo_id O por id numérico
        await pool.execute(`DELETE FROM ${table} WHERE registo_id = ? OR id = ?`, [id, id]);
        res.json({ success: true });
    } catch (e) {
        console.error("Error al eliminar:", e);
        res.status(500).json({ success: false, message: e.message });
    }
});
// ==========================================
// 7. FUNCIONALIDADE AVANÇADA: INCIDENTES (REAGENDAMENTO)
// ==========================================
app.post('/api/agendamentos/atraso', async (req, res) => {
    const { id, printer_id, minutos } = req.body; // ID do evento que falhou

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Obter o evento original para saber quando termina
        const [rows] = await connection.execute('SELECT start FROM agendamentos WHERE registo_id = ?', [id]);
        
        if (rows.length === 0) throw new Error('Agendamento não encontrado');
        
        const dataFalha = new Date(rows[0].start);

        // 2. Mover todos os eventos DESSA máquina que começam DEPOIS do inicio deste evento
        // SQL: Adicionar X minutos a start e end
        const sqlShift = `
            UPDATE agendamentos 
            SET start = DATE_ADD(start, INTERVAL ? MINUTE), 
                end = DATE_ADD(end, INTERVAL ? MINUTE)
            WHERE printer_id = ? AND start >= ?
        `;

        // Format Date para MySQL
        const mysqlDate = dataFalha.toISOString().slice(0, 19).replace('T', ' ');

        await connection.execute(sqlShift, [minutos, minutos, printer_id, mysqlDate]);

        await connection.commit();
        res.json({ success: true, message: 'Calendário reajustado' });

    } catch (e) {
        await connection.rollback();
        console.error("Erro ao reagendar:", e);
        res.status(500).json({ success: false, message: e.message });
    } finally {
        connection.release();
    }
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================
async function startServer() {
    await initDatabase();
    app.listen(PORT, () => {
        console.log(`🚀 Servidor a correr na porta ${PORT}`);
        console.log(`📂 Frontend deve estar em ./public`);
    });
}

startServer();
