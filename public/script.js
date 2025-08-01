class InstagramScraperApp {
    constructor() {
        this.isLoggedIn = false;
        this.countdownInterval = null;
        this.progressInterval = null;
        
        this.initializeApp();
        this.loadRateLimitStatus();
    }

    initializeApp() {
        // Event listeners
        document.getElementById('loginBtn').addEventListener('click', () => this.handleLogin());
        document.getElementById('searchBtn').addEventListener('click', () => this.handleSearch());
        document.getElementById('exportBtn').addEventListener('click', () => this.exportResults());
        document.getElementById('refreshBtn').addEventListener('click', () => this.loadResults());
        document.getElementById('showHistoryBtn').addEventListener('click', () => this.loadHistory());
        document.getElementById('clearAllBtn').addEventListener('click', () => this.clearAllData());
        document.getElementById('logoutBtn').addEventListener('click', () => this.handleLogout());
        
        // Enter key support
        document.getElementById('password').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleLogin();
        });
        
        document.getElementById('hashtag').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSearch();
        });

        // Auto-refresh rate limit status
        setInterval(() => this.loadRateLimitStatus(), 30000);
    }

    async handleLogin() {
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value.trim();
        const loginBtn = document.getElementById('loginBtn');

        if (!username || !password) {
            this.showStatus('loginStatus', 'Kullanıcı adı ve şifre gerekli!', 'error');
            return;
        }

        loginBtn.disabled = true;
        loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Giriş yapılıyor...';
        this.showLoading(true, 'Instagram\'a giriş yapılıyor...');

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password })
            });

            const result = await response.json();

            if (result.success) {
                this.isLoggedIn = true;
                this.showStatus('loginStatus', result.message, 'success');
                
                // Show other sections
                document.getElementById('searchSection').classList.remove('hidden');
                document.getElementById('resultsSection').classList.remove('hidden');
                document.getElementById('historySection').classList.remove('hidden');
                
                // Load existing data
                await this.loadResults();
                await this.loadRateLimitStatus();
                
            } else {
                this.showStatus('loginStatus', result.message, 'error');
            }
        } catch (error) {
            console.error('Login error:', error);
            this.showStatus('loginStatus', 'Giriş sırasında hata oluştu', 'error');
        } finally {
            loginBtn.disabled = false;
            loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Giriş Yap';
            this.showLoading(false);
        }
    }

    async handleSearch() {
        const hashtag = document.getElementById('hashtag').value.trim();
        const maxFollowers = parseInt(document.getElementById('maxFollowers').value);
        const city = document.getElementById('city').value.trim();
        const searchBtn = document.getElementById('searchBtn');

        if (!hashtag || !maxFollowers) {
            alert('Hashtag ve maksimum takipçi sayısı gerekli!');
            return;
        }

        searchBtn.disabled = true;
        searchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aranıyor...';
        
        this.showLoading(true, 'Instagram\'da işletme hesapları aranıyor...');
        this.startProgressSimulation();

        try {
            const response = await fetch('/api/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ hashtag, maxFollowers, city })
            });

            const result = await response.json();

            if (result.success) {
                const { newAccounts, totalFound, newFound } = result.data;
                
                this.showStatus('searchStatus', 
                    `Arama tamamlandı! ${totalFound} hesap incelendi, ${newFound} yeni işletme hesabı bulundu.`, 
                    'success'
                );
                
                await this.loadResults();
                await this.loadRateLimitStatus();
                this.startCountdown();
                
            } else {
                if (response.status === 429) {
                    this.showStatus('searchStatus', result.message, 'error');
                    this.startCountdown(result.retryAfter);
                } else {
                    this.showStatus('searchStatus', result.message, 'error');
                }
            }
        } catch (error) {
            console.error('Search error:', error);
            this.showStatus('searchStatus', 'Arama sırasında hata oluştu', 'error');
        } finally {
            searchBtn.disabled = false;
            searchBtn.innerHTML = '<i class="fas fa-search"></i> Arama Başlat';
            this.showLoading(false);
            this.stopProgressSimulation();
        }
    }

    async loadResults() {
        try {
            const response = await fetch('/api/accounts');
            const result = await response.json();

            if (result.success) {
                this.displayResults(result.data);
            }
        } catch (error) {
            console.error('Error loading results:', error);
        }
    }

    displayResults(accounts) {
        const resultsList = document.getElementById('resultsList');
        const totalResults = document.getElementById('totalResults');
        
        totalResults.textContent = accounts.length;
        
        if (accounts.length === 0) {
            resultsList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-search"></i>
                    <p>Henüz işletme hesabı bulunamadı.</p>
                    <p>Arama yaparak başlayın!</p>
                </div>
            `;
            return;
        }

        // Sort by followers (descending)
        accounts.sort((a, b) => b.followers - a.followers);

        resultsList.innerHTML = accounts.map(account => `
            <div class="result-item fade-in">
                <div class="result-info">
                    <div class="result-username">@${account.username}</div>
                    <div class="result-followers">
                        <i class="fas fa-users"></i> ${account.followers.toLocaleString()} takipçi
                    </div>
                    ${account.bio ? `<div class="result-bio">${account.bio}</div>` : ''}
                </div>
                <div class="result-meta">
                    <span class="result-hashtag">#${account.hashtag}</span>
                    <a href="https://instagram.com/${account.username}" target="_blank" class="result-link">
                        <i class="fas fa-external-link-alt"></i> Profil
                    </a>
                </div>
            </div>
        `).join('');
    }

    async loadHistory() {
        try {
            const response = await fetch('/api/history');
            const result = await response.json();

            if (result.success) {
                this.displayHistory(result.data);
            }
        } catch (error) {
            console.error('Error loading history:', error);
        }
    }

    displayHistory(history) {
        const historyList = document.getElementById('historyList');
        
        if (history.length === 0) {
            historyList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-history"></i>
                    <p>Henüz arama geçmişi yok.</p>
                </div>
            `;
            return;
        }

        historyList.innerHTML = history.map(search => `
            <div class="history-item slide-in">
                <div class="history-date">
                    <i class="fas fa-calendar"></i> ${new Date(search.date).toLocaleString('tr-TR')}
                </div>
                <div class="history-params">
                    <i class="fas fa-hashtag"></i> ${search.params.hashtag} | 
                    <i class="fas fa-users"></i> Max: ${search.params.maxFollowers.toLocaleString()}
                    ${search.params.city ? ` | <i class="fas fa-map-marker-alt"></i> ${search.params.city}` : ''}
                </div>
                <div class="history-results">
                    <span class="history-count">
                        <i class="fas fa-plus-circle"></i> ${search.resultCount} yeni hesap
                    </span>
                    <span class="history-total">
                        <i class="fas fa-eye"></i> ${search.totalFound} toplam incelendi
                    </span>
                </div>
            </div>
        `).join('');
    }

    async loadRateLimitStatus() {
        try {
            const response = await fetch('/api/rate-limit');
            const result = await response.json();

            if (result.success) {
                const { remainingPoints, msBeforeNext } = result.data;
                
                document.getElementById('remainingSearches').textContent = remainingPoints;
                
                if (msBeforeNext > 0) {
                    const resetTime = new Date(Date.now() + msBeforeNext);
                    document.getElementById('nextReset').textContent = resetTime.toLocaleTimeString('tr-TR');
                } else {
                    document.getElementById('nextReset').textContent = 'Şimdi';
                }

                // Disable search if no remaining points
                const searchBtn = document.getElementById('searchBtn');
                if (remainingPoints <= 0) {
                    searchBtn.disabled = true;
                    searchBtn.innerHTML = '<i class="fas fa-clock"></i> Limit Aşıldı';
                } else if (!searchBtn.innerHTML.includes('spinner')) {
                    searchBtn.disabled = false;
                    searchBtn.innerHTML = '<i class="fas fa-search"></i> Arama Başlat';
                }
            }
        } catch (error) {
            console.error('Error loading rate limit status:', error);
        }
    }

    async exportResults() {
        try {
            const response = await fetch('/api/export');
            const blob = await response.blob();
            
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `instagram_accounts_${new Date().toISOString().split('T')[0]}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            this.showStatus('exportStatus', 'Veriler başarıyla dışa aktarıldı!', 'success');
        } catch (error) {
            console.error('Export error:', error);
            this.showStatus('exportStatus', 'Dışa aktarma sırasında hata oluştu', 'error');
        }
    }

    async clearAllData() {
        if (!confirm('Tüm veriler (hesaplar ve geçmiş) silinecek. Emin misiniz?')) {
            return;
        }

        try {
            const response = await fetch('/api/clear', { method: 'DELETE' });
            const result = await response.json();

            if (result.success) {
                await this.loadResults();
                document.getElementById('historyList').innerHTML = '';
                this.showStatus('clearStatus', 'Tüm veriler temizlendi', 'success');
            }
        } catch (error) {
            console.error('Clear error:', error);
            this.showStatus('clearStatus', 'Temizleme sırasında hata oluştu', 'error');
        }
    }

    async handleLogout() {
        if (!confirm('Çıkış yapmak istediğinizden emin misiniz?')) {
            return;
        }

        try {
            await fetch('/api/logout', { method: 'POST' });
            
            // Reset UI
            this.isLoggedIn = false;
            document.getElementById('searchSection').classList.add('hidden');
            document.getElementById('resultsSection').classList.add('hidden');
            document.getElementById('historySection').classList.add('hidden');
            
            // Clear form
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
            
            this.showStatus('loginStatus', 'Başarıyla çıkış yapıldı', 'info');
            
        } catch (error) {
            console.error('Logout error:', error);
        }
    }

    startCountdown(seconds = 3600) {
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
        }

        const countdownElement = document.getElementById('countdownTimer');
        const countdownDisplay = document.getElementById('countdown');
        
        countdownElement.classList.remove('hidden');
        
        let timeLeft = seconds;
        
        this.countdownInterval = setInterval(() => {
            const hours = Math.floor(timeLeft / 3600);
            const minutes = Math.floor((timeLeft % 3600) / 60);
            const secs = timeLeft % 60;
            
            countdownDisplay.textContent = 
                `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            
            timeLeft--;
            
            if (timeLeft < 0) {
                clearInterval(this.countdownInterval);
                countdownElement.classList.add('hidden');
                this.loadRateLimitStatus();
            }
        }, 1000);
    }

    startProgressSimulation() {
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        let progress = 0;
        
        this.progressInterval = setInterval(() => {
            progress += Math.random() * 2;
            if (progress > 90) progress = 90; // Don't complete until actual completion
            
            progressFill.style.width = `${progress}%`;
            progressText.textContent = `${Math.round(progress)}%`;
        }, 500);
    }

    stopProgressSimulation() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            
            // Complete the progress
            document.getElementById('progressFill').style.width = '100%';
            document.getElementById('progressText').textContent = '100%';
        }
    }

    showLoading(show, text = 'İşlem yapılıyor...') {
        const overlay = document.getElementById('loadingOverlay');
        const loadingText = document.getElementById('loadingText');
        
        if (show) {
            loadingText.textContent = text;
            overlay.classList.remove('hidden');
        } else {
            overlay.classList.add('hidden');
        }
    }

    showStatus(elementId, message, type) {
        // Create or get status element
        let statusElement = document.getElementById(elementId);
        if (!statusElement) {
            statusElement = document.createElement('div');
            statusElement.id = elementId;
            statusElement.className = 'status';
            
            // Find appropriate parent
            const section = document.querySelector(`#${elementId.replace('Status', 'Section')}`);
            if (section) {
                section.appendChild(statusElement);
            }
        }
        
        statusElement.textContent = message;
        statusElement.className = `status ${type}`;
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            statusElement.classList.add('hidden');
        }, 5000);
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new InstagramScraperApp();
});
