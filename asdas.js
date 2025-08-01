const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker');

// Add stealth plugin and adblocker
puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

class InstagramScraper {
    constructor() {
        this.browser = null;
        this.page = null;
        this.isLoggedIn = false;
    }

    /**
     * Safe wait method that works with both older and newer Puppeteer versions
     * @param {number} milliseconds - Time to wait in milliseconds
     */

    async searchBusinessAccounts(hashtag, maxFollowers, city = null) {
        if (!this.isLoggedIn) {
            throw new Error('Önce giriş yapmalısınız');
        }

        try {
            console.log(`🔍 Searching for hashtag: ${hashtag}`);

            const cleanHashtag = hashtag.replace('#', '');
            // Instagram'ın hashtag sayfasına doğrudan gitmek daha verimli olabilir.
            // Eğer keyword araması çalışmıyorsa bu satırı aktif edin:
            // const hashtagUrl = `https://www.instagram.com/explore/tags/${cleanHashtag}/`;
            // await this.page.goto(hashtagUrl, { waitUntil: 'networkidle2', timeout: 60000 });

            // Şu anki kodunuzdaki gibi keyword aramasına devam ediyoruz:
            await this.page.goto(`https://www.instagram.com/explore/search/keyword/?q=%23${cleanHashtag}`, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            const postThumbnailLinkSelector = 'main a[href*="/p/"][role="link"]';

            console.log(`Waiting for post thumbnail links with selector: ${postThumbnailLinkSelector}`);

            try {
                await this.page.waitForSelector(postThumbnailLinkSelector, { visible: true, timeout: 45000 });
                console.log(`✅ Post thumbnail links are visible.`);
                await this.safeWait(3000);

            } catch (error) { // 'error' değişkenini yakaladığınızdan emin olun
                console.error(`❌ Failed to find post thumbnail links on the hashtag page. Selector might be outdated or page did not load correctly. Current URL: ${this.page.url()}`, error);
                throw error;
            }

            const businessAccounts = [];
            const processedUsers = new Set(); // Sadece kullanıcı adlarını saklayacak
            let scrollAttempts = 0;
            const maxScrollAttempts = 5; // Daha fazla kaydırma denemesi, istediğiniz kadar artırabilirsiniz.

            while (businessAccounts.length < 50 && scrollAttempts < maxScrollAttempts) {
                const postLinks = await this.page.$$eval(postThumbnailLinkSelector, links =>
                    links.map(link => link.href)
                );
                console.log(`📄 Found ${postLinks.length} potential posts on current view for hashtag ${hashtag}.`);

                for (const postUrl of postLinks) {
                    if (businessAccounts.length >= 50) break; // 50 hesaba ulaşınca dur

                    let newPage;
                    try {
                        // Yeni bir sayfa açıp gönderiye git
                        newPage = await this.browser.newPage();
                        await newPage.goto(postUrl, { waitUntil: 'networkidle2', timeout: 30000 });

                        // Kullanıcı adını gönderi sayfasından çekme - GÜNCELLENMİŞ SEÇİCİLER
                        const username = await newPage.evaluate(() => {
                            // 1. En güvenilir yöntem: Header içindeki doğrudan profil linkini bul
                            const profileLinkElement = document.querySelector('header a[href^="/"][href$="/"]:not([href*="/p/"]):not([href*="/reel/"]):not([href*="/stories/"]):not([href*="/comments/"]):not([href*="/tags/"])');
                            if (profileLinkElement) {
                                const href = profileLinkElement.href;
                                const parts = href.split('/').filter(part => part); // Boş parçaları kaldır
                                if (parts.length > 0) {
                                    return parts[parts.length - 1]; // Son parçayı (kullanıcı adı) döndür
                                }
                            }

                            // 2. Alternatif: Verdiğiniz HTML yapısına uygun spesifik span/div seçicisi
                            // Bu seçicinin class isimleri dinamik olabilir, test etmek gerek.
                            const usernameSpanSpecific = document.querySelector('header .x1i10hfl.xjbqb8w span.xt0psk2 span.xjp7ctv div.x78zum5 div.x1iyjqo2');
                            if (usernameSpanSpecific) {
                                return usernameSpanSpecific.textContent;
                            }

                            // 3. Genel fallback: Header içindeki tüm potansiyel linkleri kontrol et
                            const allHeaderLinks = Array.from(document.querySelectorAll('header a[href]'));
                            for (const link of allHeaderLinks) {
                                const href = link.href;
                                if (href && !href.includes('/p/') && !href.includes('/reel/') && !href.includes('/stories/') && !href.includes('/comments/') && !href.includes('/tags/')) {
                                    const parts = href.split('/').filter(part => part);
                                    if (parts.length > 0) {
                                        return parts[parts.length - 1];
                                    }
                                }
                            }
                            return null; // Hiçbir yöntemle bulunamazsa null döndür
                        });

                        // Kullanıcı adı yoksa veya daha önce işlenmişse atla
                        if (!username) {
                            console.log(`ℹ️ Could not extract username from post: ${postUrl}. Skipping.`);
                            await newPage.close();
                            continue;
                        }
                        if (processedUsers.has(username)) {
                            console.log(`ℹ️ User @${username} already processed. Skipping.`);
                            await newPage.close();
                            continue;
                        }

                        processedUsers.add(username); // Yeni kullanıcıyı sete ekle

                        console.log(`🌐 Checking profile: @${username}`);

                        // Kullanıcı profiline git
                        await newPage.goto(`https://www.instagram.com/${username}/`, {
                            waitUntil: 'networkidle2',
                            timeout: 30000 // Timeout artırıldı
                        });

                        // İşletme hesabı olup olmadığını, takipçi sayısını ve biyografiyi çekme - GÜNCELLENMİŞ SEÇİCİLER
                        const accountInfo = await newPage.evaluate(() => {
                            // İşletme göstergelerini kontrol edin (genişletilmiş seçiciler)
                            const isBusinessAccount = !!(
                                document.querySelector('[aria-label*="Contact"]') ||
                                document.querySelector('a[href*="mailto:"]') ||
                                document.querySelector('a[href*="tel:"]') ||
                                document.querySelector('[data-testid="business_category"]') ||
                                document.querySelector('div[class*="business"]') ||
                                document.querySelector('button[aria-label="Email button"]') || // E-posta düğmesi
                                document.querySelector('button[aria-label="Call button"]') || // Çağrı düğmesi
                                document.querySelector('button[aria-label="Directions button"]') || // Yol Tarifi düğmesi
                                document.querySelector('span[role="button"][tabindex="0"][class*="x1lliihq"]') || // "İletişim" veya "E-posta" gibi düğmeler için genel bir span/button
                                document.querySelector('a[href*="business.instagram.com"]') // Eğer profile business linki varsa
                            );

                            // Takipçi sayısını al (güncellenmiş ve daha sağlam)
                            let followers = 0;
                            const followerElements = document.querySelectorAll('a[href$="/followers/"] span[title], a[href$="/followers/"] span');

                            for (const element of followerElements) {
                                const text = element.title || element.textContent || '';
                                if (text) {
                                    const match = text.replace(/,/g, '').match(/(\d+\.?\d*[KMB]?)/i);
                                    if (match) {
                                        let numStr = match[1];
                                        if (numStr.includes('K')) {
                                            followers = parseFloat(numStr) * 1000;
                                        } else if (numStr.includes('M')) {
                                            followers = parseFloat(numStr) * 1000000;
                                        } else if (numStr.includes('B')) {
                                            followers = parseFloat(numStr) * 1000000000;
                                        } else {
                                            followers = parseInt(numStr, 10);
                                        }
                                        break; // İlk bulunan takipçi sayısını kullan
                                    }
                                }
                            }
                            
                            // Biyografi çekme (genişletilmiş seçiciler)
                            const bioElement = document.querySelector('div[data-testid="user-bio"] span, .-vDIg span, .x7a10h_ span, .x1iyjqo2 span');
                            const bio = bioElement ? bioElement.textContent : '';

                            return {
                                isBusinessAccount,
                                followers,
                                bio
                            };
                        });

                        await newPage.close(); // Sekmeyi kapat

                        // Kriterlere göre filtrele
                        if (accountInfo.isBusinessAccount &&
                            accountInfo.followers <= maxFollowers &&
                            accountInfo.followers > 100) { // Minimum 100 takipçi filtresi

                            // Şehir filtresi (eğer belirtildiyse)
                            if (city) {
                                const cityLower = city.toLowerCase();
                                const bioLower = accountInfo.bio.toLowerCase();
                                if (!bioLower.includes(cityLower)) {
                                    console.log(`ℹ️ Account @${username} does not match city filter "${city}". Skipping.`);
                                    continue; // Şehir uyuşmuyorsa atla
                                }
                            }

                            businessAccounts.push({
                                username,
                                followers: accountInfo.followers,
                                bio: accountInfo.bio,
                                hashtag: cleanHashtag,
                                foundAt: new Date().toISOString()
                            });

                            console.log(`✅ Found business account: @${username} (${accountInfo.followers} followers)`);
                        } else {
                            console.log(`➡️ Account @${username} skipped. Business: ${accountInfo.isBusinessAccount}, Followers: ${accountInfo.followers}. (Max: ${maxFollowers}, Min: 100)`);
                        }

                        // İstekler arasında gecikme
                        await this.safeWait(1000 + Math.random() * 2000); // 1-3 saniye rastgele bekleme

                    } catch (error) {
                        console.error(`❌ Error processing post ${postUrl} or profile @${username || 'N/A'}:`, error.message);
                        if (newPage && !newPage.isClosed()) {
                            await newPage.close(); // Hata durumunda da sekmeyi kapat
                        }
                        // Bu hatanın kaynağını daha iyi anlamak için continue yerine throw yapabilirsiniz
                        // Ancak döngünün devam etmesi için continue daha uygun olabilir.
                        continue;
                    }
                }

                // Daha fazla gönderi yüklemek için aşağı kaydır
                await this.page.evaluate(() => {
                    window.scrollTo(0, document.body.scrollHeight);
                });

                await this.safeWait(3000); // Kaydırma sonrası yüklenmesi için bekle
                scrollAttempts++;
                console.log(`Scrolled down. Scroll attempt: ${scrollAttempts}/${maxScrollAttempts}. Found ${businessAccounts.length} business accounts so far.`);
            }

            console.log(`🎯 Search completed. Found ${businessAccounts.length} business accounts`);
            return businessAccounts;

        } catch (error) {
            console.error('❌ Search failed overall:', error);
            throw error;
        }
    }
