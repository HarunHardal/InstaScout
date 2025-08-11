const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs-extra');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const InstagramScraper = require('./scraper');

const app = express();
const PORT = 3000;

// Rate limiter - 25 requests per hour per IP
const rateLimiter = new RateLimiterMemory({
  keyGenerator: (req) => req.ip,
  points: 25, // Number of requests
  duration: 3600, // Per 1 hour
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: false // Allow inline scripts for development
}));
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Ensure data directory exists
fs.ensureDirSync('./data');

// Initialize data files
const initializeDataFiles = async () => {
  const accountsFile = './data/accounts.json';
  const historyFile = './data/history.json';
  
  if (!await fs.pathExists(accountsFile)) {
    await fs.writeJson(accountsFile, []);
  }
  
  if (!await fs.pathExists(historyFile)) {
    await fs.writeJson(historyFile, []);
  }
};

// Instagram scraper instance
let scraper = null;

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Kullanıcı adı ve şifre gerekli' 
      });
    }

    scraper = new InstagramScraper();
    const loginResult = await scraper.login(username, password);
    
    if (loginResult.success) {
      res.json({ 
        success: true, 
        message: 'Başarıyla giriş yapıldı' 
      });
    } else {
      res.status(401).json({ 
        success: false, 
        message: loginResult.message 
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Giriş sırasında hata oluştu' 
    });
  }
});

// Search endpoint with rate limiting
app.post('/api/search', async (req, res) => {
  try {
    // Check rate limit
    await rateLimiter.consume(req.ip);
    
    const { hashtag, maxFollowers, city } = req.body;
    
    if (!hashtag || !maxFollowers) {
      return res.status(400).json({ 
        success: false, 
        message: 'Hashtag ve maksimum takipçi sayısı gerekli' 
      });
    }

    if (!scraper) {
      return res.status(401).json({ 
        success: false, 
        message: 'Önce giriş yapmalısınız' 
      });
    }

    // Load existing accounts
    const existingAccounts = await fs.readJson('./data/accounts.json');
    const existingUsernames = new Set(existingAccounts.map(acc => acc.username));

    // Perform search
    const searchResults = await scraper.searchBusinessAccounts(hashtag, maxFollowers, city);
    
    // Filter out existing accounts
    const newAccounts = searchResults.filter(account => 
      !existingUsernames.has(account.username)
    );

    // Save new accounts
    const updatedAccounts = [...existingAccounts, ...newAccounts];
    await fs.writeJson('./data/accounts.json', updatedAccounts);

    // Save search history
    const history = await fs.readJson('./data/history.json');
    const searchRecord = {
      id: Date.now(),
      date: new Date().toISOString(),
      params: { hashtag, maxFollowers, city },
      resultCount: newAccounts.length,
      totalFound: searchResults.length
    };
    
    history.unshift(searchRecord);
    
    // Keep only last 100 searches
    if (history.length > 100) {
      history.splice(100);
    }
    
    await fs.writeJson('./data/history.json', history);

    res.json({
      success: true,
      data: {
        newAccounts,
        totalFound: searchResults.length,
        newFound: newAccounts.length
      }
    });

  } catch (rateLimiterRes) {
    if (rateLimiterRes.remainingPoints !== undefined) {
      const secs = Math.round(rateLimiterRes.msBeforeNext / 1000) || 1;
      res.set('Retry-After', String(secs));
      res.status(429).json({
        success: false,
        message: 'Çok fazla istek. Lütfen bekleyin.',
        retryAfter: secs
      });
    } else {
      console.error('Search error:', rateLimiterRes);
      res.status(500).json({
        success: false,
        message: 'Arama sırasında hata oluştu'
      });
    }
  }
});

// Get rate limit status
app.get('/api/rate-limit', async (req, res) => {
  try {
    const resRateLimiter = await rateLimiter.get(req.ip);
    
    res.json({
      success: true,
      data: {
        remainingPoints: resRateLimiter ? resRateLimiter.remainingPoints : 25,
        msBeforeNext: resRateLimiter ? resRateLimiter.msBeforeNext : 0,
        totalHits: resRateLimiter ? resRateLimiter.totalHits : 0
      }
    });
  } catch (error) {
    res.json({
      success: true,
      data: {
        remainingPoints: 25,
        msBeforeNext: 0,
        totalHits: 0
      }
    });
  }
});

// Get search history
app.get('/api/history', async (req, res) => {
  try {
    const history = await fs.readJson('./data/history.json');
    res.json({ success: true, data: history });
  } catch (error) {
    res.json({ success: true, data: [] });
  }
});

// Get all found accounts
app.get('/api/accounts', async (req, res) => {
  try {
    const accounts = await fs.readJson('./data/accounts.json');
    res.json({ success: true, data: accounts });
  } catch (error) {
    res.json({ success: true, data: [] });
  }
});

// Export accounts
app.get('/api/export', async (req, res) => {
  try {
    const accounts = await fs.readJson('./data/accounts.json');
    const usernames = accounts.map(acc => acc.username).join('\n');
    
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="instagram_accounts.txt"');
    res.send(usernames);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Export hatası' });
  }
});

// Clear data
app.delete('/api/clear', async (req, res) => {
  try {
    await fs.writeJson('./data/accounts.json', []);
    await fs.writeJson('./data/history.json', []);
    res.json({ success: true, message: 'Veriler temizlendi' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Temizleme hatası' });
  }
});

// Logout
app.post('/api/logout', async (req, res) => {
  try {
    if (scraper) {
      await scraper.close();
      scraper = null;
    }
    res.json({ success: true, message: 'Çıkış yapıldı' });
  } catch (error) {
    res.json({ success: true, message: 'Çıkış yapıldı' });
  }
});

// Error handling
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ 
    success: false, 
    message: 'Sunucu hatası' 
  });
});

// Start server
const startServer = async () => {
  await initializeDataFiles();
  
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Instagram Business Scraper is ready!`);
  });
};

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  if (scraper) {
    await scraper.close();
  }
  process.exit(0);
});

startServer().catch(console.error);

