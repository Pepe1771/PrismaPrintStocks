const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// ==================== CONFIGURACIÓN ====================
// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Configuração da conexão MySQL
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'Pepe17',
  password: process.env.DB_PASSWORD || 'Giuseppe1704',
  database: process.env.DB_NAME || 'gestor_stock_3d',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

let pool;

// Inicializar pool de conexões
async function initDatabase() {
  try {
    pool = mysql.createPool(dbConfig);
    console.log('✅ Conexão com MySQL estabelecida com sucesso');
    
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    console.log('✅ Pool de conexões MySQL ativo');
  } catch (error) {
    console.error('❌ Erro ao conectar ao MySQL:', error.message);
    process.exit(1);
  }
}

// ==================== ROTAS DE AUTENTICAÇÃO ====================

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Verifica utilizador e senha (nota: em produção idealmente usaria bcrypt para senhas)
    const [rows] = await pool.execute(
      'SELECT id, username, name, role FROM utilizadores WHERE username = ? AND password = ?',
      [username, password]
    );
    
    if (rows.length > 0) {
      res.json({ 
        success: true, 
        user: { 
          id: rows[0].id, 
          username: rows[0].username,
          name: rows[0].name,
          role: rows[0].role
        } 
      });
    } else {
      res.status(401).json({ success: false, message: 'Credenciais inválidas' });
    }
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ success: false, message: 'Erro no servidor' });
  }
});

// ==================== FUNÇÃO AUXILIAR DE MAPEAMENTO ====================

// Mapeia o nome da entidade para o nome da tabela e chaves
const entityMap = {
  filament: { table: 'filamentos', pk: 'id', type: 'filament' },
  purchase: { table: 'entradas', pk: 'id', type: 'purchase' },
  print: { table: 'impressoes', pk: 'id', type: 'print' },
  product: { table: 'produtos', pk: 'id', type: 'product' },
  supplier: { table: 'fornecedores', pk: 'id', type: 'supplier' }
};

// ==================== ROTAS DE DADOS (CRUD) ====================

// 1. Rota para LISTAR TODOS os registos (CORRIGIDA)
// Esta é a parte importante que traduz os dados do MySQL para o App.js
app.get('/api/registos', async (req, res) => {
  try {
    let allRecords = [];
    
    for (const type in entityMap) {
      const map = entityMap[type];
      
      // Busca dados brutos do MySQL
      const [rows] = await pool.execute(`SELECT * FROM ${map.table}`);
      
      // Traduz e normaliza cada linha
      const records = rows.map(row => {
        // Objeto base
        const record = {
          __backendId: row.id,
          id: row.registo_id || row.id.toString(), // ID lógico para o frontend
          type: map.type,
          timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : (row.timestamp || new Date().toISOString())
        };

        // Mapeamento específico por tipo (Snake_case -> CamelCase e Texto -> Número)
        if (type === 'filament') {
            record.barcode = row.barcode;
            record.name = row.name;
            record.material = row.material;
            record.color = row.color;
            // Verifica se vem como nome_snake ou nomeCamel e converte para numero
            record.weightPerUnit = parseFloat(row.weight_per_unit || row.weightPerUnit || 0);
            record.pricePerUnit = parseFloat(row.price_per_unit || row.pricePerUnit || 0);
            record.minStock = parseFloat(row.min_stock || row.minStock || 0);
            record.supplier = row.supplier;
        } 
        else if (type === 'purchase') {
            record.filamentBarcode = row.filament_barcode || row.filamentBarcode;
            record.quantityPurchased = parseFloat(row.quantity_purchased || row.quantityPurchased || 0);
            record.purchaseDate = row.purchase_date || row.purchaseDate;
            record.supplier = row.supplier;
        }
        else if (type === 'print') {
            record.printName = row.print_name || row.printName;
            record.filamentsUsed = row.filaments_used || row.filamentsUsed;
            record.notes = row.notes;
        }
        else if (type === 'product') {
            record.barcode = row.barcode;
            record.name = row.name;
            record.productCategory = row.product_category || row.productCategory;
            record.stock = parseInt(row.stock || 0);
            record.cost = parseFloat(row.cost || 0);
            record.salePrice = parseFloat(row.sale_price || row.salePrice || 0);
        }
        else if (type === 'supplier') {
            record.supplierName = row.supplier_name || row.supplierName;
            record.supplierEmail = row.supplier_email || row.supplierEmail;
            record.supplierPhone = row.supplier_phone || row.supplierPhone;
            record.supplierAddress = row.supplier_address || row.supplierAddress;
        }

        return record;
      });
      
      allRecords = allRecords.concat(records);
    }
    
    res.json({ success: true, data: allRecords });
  } catch (error) {
    console.error('Erro ao listar todos os registos:', error);
    res.status(500).json({ success: false, message: 'Erro ao listar todos os registos' });
  }
});

// 2. Rota para CRIAR registos
app.post('/api/registos/:type', async (req, res) => {
  const { type } = req.params;
  const map = entityMap[type];
  if (!map) return res.status(400).json({ success: false, message: 'Tipo inválido' });

  try {
    const record = req.body;
    // Remove campos de controle do frontend
    let fields = Object.keys(record).filter(key => key !== '__backendId' && key !== 'type');
    
    // Adiciona registo_id (ID gerado pelo frontend)
    fields.push('registo_id');
    const values = fields.map(key => key === 'registo_id' ? record.id : record[key]);
    
    const placeholders = fields.map(() => '?').join(', ');
    const fieldNames = fields.join(', ');

    // Nota: Se a BD usar snake_case, certifique-se que o frontend envia snake_case 
    // ou adicione um tradutor aqui também se falhar a inserção.
    const query = `INSERT INTO ${map.table} (${fieldNames}) VALUES (${placeholders})`;
    const [result] = await pool.execute(query, values);
    
    res.json({ success: true, backendId: result.insertId, message: 'Criado com sucesso' });
  } catch (error) {
    console.error(`Erro ao criar (${type}):`, error);
    res.status(500).json({ success: false, message: 'Erro ao criar registo' });
  }
});

// 3. Rota para ATUALIZAR registos
app.put('/api/registos/:type/:backendId', async (req, res) => {
  const { type, backendId } = req.params;
  const map = entityMap[type];
  if (!map) return res.status(400).json({ success: false, message: 'Tipo inválido' });

  try {
    const record = req.body;
    const fields = Object.keys(record).filter(key => key !== '__backendId' && key !== 'type' && key !== 'id');
    
    const setClauses = fields.map(key => `${key} = ?`).join(', ');
    const values = fields.map(key => record[key]);
    values.push(backendId);

    const query = `UPDATE ${map.table} SET ${setClauses} WHERE ${map.pk} = ?`;
    const [result] = await pool.execute(query, values);
    
    if (result.affectedRows > 0) res.json({ success: true, message: 'Atualizado com sucesso' });
    else res.status(404).json({ success: false, message: 'Registo não encontrado' });
  } catch (error) {
    console.error(`Erro ao atualizar (${type}):`, error);
    res.status(500).json({ success: false, message: 'Erro ao atualizar' });
  }
});

// 4. Rota para ELIMINAR registos
app.delete('/api/registos/:type/:backendId', async (req, res) => {
  const { type, backendId } = req.params;
  const map = entityMap[type];
  if (!map) return res.status(400).json({ success: false, message: 'Tipo inválido' });

  try {
    const query = `DELETE FROM ${map.table} WHERE ${map.pk} = ?`;
    const [result] = await pool.execute(query, [backendId]);
    
    if (result.affectedRows > 0) res.json({ success: true, message: 'Eliminado com sucesso' });
    else res.status(404).json({ success: false, message: 'Registo não encontrado' });
  } catch (error) {
    console.error(`Erro ao eliminar (${type}):`, error);
    res.status(500).json({ success: false, message: 'Erro ao eliminar' });
  }
});

// ==================== INICIALIZAÇÃO ====================

async function startServer() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`🚀 Servidor a correr em http://localhost:${PORT}`);
    console.log(`📊 API disponível em http://localhost:${PORT}/api`);
  });
}

startServer();