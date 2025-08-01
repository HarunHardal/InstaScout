const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker');
const { timeout } = require('puppeteer');

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
  async safeWait(milliseconds) {
    try {
      if (typeof this.page.waitForTimeout === 'function') {
        // Newer Puppeteer
        await this.page.waitForTimeout(milliseconds);
      } else if (typeof this.page.waitFor === 'function') {
        // Older Puppeteer
        await this.page.waitFor(milliseconds);
      } else {
        // Fallback using setTimeout
        await new Promise(resolve => setTimeout(resolve, milliseconds));
      }
    } catch (error) {
      console.warn(`⚠️ Warning: Wait failed, using setTimeout fallback. Error: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, milliseconds));
    }
  }

  async initialize() {
    try {
      this.browser = await puppeteer.launch({
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--window-size=1920,1080'
        ],
        defaultViewport: {
          width: 1920,
          height: 1080
        }
      });

      this.page = await this.browser.newPage();

      // Set user agent
      await this.page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Set extra headers
      await this.page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9,tr;q=0.8'
      });

      console.log('✅ Browser initialized');
      return true;
    } catch (error) {
      console.error('❌ Browser initialization failed:', error);
      throw error;
    }
  }

  async login(username, password) {
    try {
      if (!this.browser) {
        await this.initialize();
      }

      console.log('🔐 Starting login process...');

      // Navigate to Instagram login page
      await this.page.goto('https://www.instagram.com/accounts/login/', {
        waitUntil: 'networkidle2',
        timeout: 360000
      });

      // Wait for login form
      await this.page.waitForSelector('input[name="username"]', { timeout: 100000 });

      // Fill login form
      await this.page.type('input[name="username"]', username, { delay: 100 });
      await this.page.type('input[name="password"]', password, { delay: 100 });

      // Click login button
      await this.page.click('button[type="submit"]');

      // Use our safe wait method instead of waitForTimeout
      await this.safeWait(36000);

      // Check if login was successful
      const currentUrl = this.page.url();

      if (currentUrl.includes('/accounts/login/')) {

        const generalError = await this.page.$eval('div[role="alert"]', el => el.textContent).catch(() => null);
        if (generalError) {
          console.error('❌ General login error:', generalError);
          return { success: false, message: generalError };
        }
        const challengeText = await this.page.$eval('h2', el => el.textContent).catch(() => null);
        if (challengeText && challengeText.includes('Güvenliğin İçin')) { // Veya benzer bir Türkçe ifade
          console.error('❌ Instagram security challenge detected.');
          return { success: false, message: 'Instagram güvenlik doğrulama istiyor. Manuel kontrol edin.' };
        }
        // Check for error messages
        const errorElement = await this.page.$('#slfErrorAlert');
        if (errorElement) {
          console.log(errorElement)
          const errorText = await this.page.evaluate(el => el.textContent, errorElement);
          return { success: false, message: errorText };
        }
        return { success: false, message: 'Giriş başarısız. Bilgilerinizi kontrol edin.' };
      }

      // NOT NOW
      try {
        const notNowButtonSelector = 'div[role="button"]'; // Tüm butonları alacağız

        // Butonun varlığını ve görünürlüğünü bekle
        await this.page.waitForSelector(notNowButtonSelector, { visible: true, timeout: 5000 }).catch(() => null);

        // Eğer buton varsa, metnini kontrol ederek tıklayın
        const foundNotNow = await this.page.evaluate((selector) => {
          const buttons = Array.from(document.querySelectorAll(selector));
          for (const button of buttons) {
            // Metni normalize et (boşlukları temizle, küçük harf yap)
            const text = button.textContent.trim().toLowerCase();
            if (text === 'not now' || 'dissmiss') {
              button.click();
              return true;
            }
          }
          return false;
        }, notNowButtonSelector);

        if (foundNotNow) {
          console.log('✅ "Not now" button clicked.');
          await this.safeWait(2000); // Tıkladıktan sonra biraz bekle
        } else {
          console.log('ℹ️ "Not now" button not found or not visible.');
        }

      } catch (e) {
        console.warn('⚠️ Error checking/clicking "Not now" button:', e.message);
        // Pop-up'ın görünmemesi normal bir durum olabilir, hatayı sadece uyarı olarak logla.
      }


      // Handle "Save Your Login Info" popup
      try {
        await this.page.waitForSelector('button', { timeout: 5000 });
        const buttons = await this.page.$$('button');
        for (const button of buttons) {
          const text = await this.page.evaluate(el => el.textContent, button);
          if (text && text.toLowerCase().includes('not now')) {
            await button.click();
            break;
          }
        }
      } catch (e) {
        // Ignore if popup doesn't appear
      }

      // Handle notification popup
      try {
        // Use our safe wait method instead of waitForTimeout
        await this.safeWait(2000);
        const buttons = await this.page.$$('button');
        for (const button of buttons) {
          const text = await this.page.evaluate(el => el.textContent, button);
          if (text && text.toLowerCase().includes('not now')) {
            await button.click();
            break;
          }
        }
      } catch (e) {
        // Ignore if popup doesn't appear
      }

      this.isLoggedIn = true;
      console.log('✅ Login successful');
      return { success: true, message: 'Giriş başarılı' };

    } catch (error) {
      console.error('❌ Login failed:', error);
      return { success: false, message: 'Giriş sırasında hata oluştu' };
    }
  }



  async searchBusinessAccounts(hashtag, maxFollowers, city = null, maxScroll=2) {
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

      while (businessAccounts.length < 50 && scrollAttempts < maxScroll) {
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


            /*-------------------------------------------------------------------------------------*/

            const username = await newPage.evaluate(() => {
              // Profil linkini içeren 'a' etiketini doğrudan hedefliyoruz.
              // Instagram'da profil linkleri genellikle şunlardan birine uyar:
              // 1. Gönderiyi paylaşan kullanıcının üstündeki link.
              // 2. Sayfa başlığındaki profil linki.
              // 3. `header` içinde yer alan ve `href` özelliği `/` ile başlayan herhangi bir link.

              // Potansiyel seçicileri daha genişletelim ve deneme sırasına koyalım.
              const potentialSelectors = [
                'header a[href^="/"][role="link"]', // Gönderi sayfasında genellikle en üstteki kullanıcı adı linki
                'a[href^="/"][role="link"]',        // Daha genel bir link seçici
                'article header a[href^="/"]',      // Gönderi içeriğindeki header altındaki link
                'div[data-testid="post-header"] a[href^="/"]' // Yeni bir data-testid yapısı varsa
              ];

              let foundHref = null;

              for (const selector of potentialSelectors) {
                const profileLinkElement = document.querySelector(selector);
                if (profileLinkElement) {
                  foundHref = profileLinkElement.getAttribute('href');
                  if (foundHref) break; // Bir link bulduğumuzda döngüden çık
                }
              }

              if (foundHref) {
                // URL'yi '/' karakterine göre ayırıp, boş parçaları temizliyoruz.
                const parts = foundHref.split('/').filter(part => part);

                // Genellikle URL'nin son boş olmayan parçası kullanıcı adıdır.
                if (parts.length > 0) {
                  const potentialUsername = parts[parts.length - 1];
                  // Temel bir kontrol: Kullanıcı adının bir sayısal ID veya Instagram'ın dahili yolları olmamasını sağlıyoruz.
                  // 'p' (post), 'reel' (reels), 'stories', 'comments', 'tags', 'explore', 'saved' gibi kelimeler genellikle kullanıcı adı değildir.
                  const instagramReservedWords = ['explore', 'p', 'reel', 'stories', 'comments', 'tags', 'saved', 'direct', 'accounts', 'challenge'];

                  if (
                    isNaN(potentialUsername) && // Tamamen sayısal bir ID olmamalı
                    potentialUsername.length > 1 && // Çok kısa olmamalı (genellikle en az 2 karakter)
                    !instagramReservedWords.includes(potentialUsername.toLowerCase()) // Instagram'ın özel kelimelerinden biri olmamalı
                  ) {
                    return potentialUsername;
                  }
                }
              }

              // Eğer hiçbir yöntemle kullanıcı adı bulunamazsa null döndür.
              return null;
            });
            /*-------------------------------------------------------------------------------------*/

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

            const accountInfo = await newPage.evaluate(() => {
              let isBusinessAccount = false;

              // Mevcut işletme göstergeleri kontrolleriniz (önceki yanıtta verilenler):
              isBusinessAccount = !!(
                document.querySelector('a[href="/direct/new/"] div[role="button"][tabindex="0"], button[aria-label*="Email"], button[aria-label*="Call"], button[aria-label*="Directions"], button[aria-label*="İletişim"]') ||
                document.querySelector('[data-testid="business_category"]') ||
                // ... diğer mevcut kontrolleriniz ...
                Array.from(document.querySelectorAll('a[href]')).some(link => {
                  const href = link.href.toLowerCase();
                  return href.includes('mailto:') || href.includes('tel:') || href.includes('maps.google.com') || href.includes('instagram.com/l/');
                })
              );

              // Biyografi çekme (bu kısım zaten doğru çalışıyor gibi görünüyor)
              // Verdiğiniz HTML'e göre: <div data-testid="user-bio"> veya benzeri bir üst element olması lazım.
              // HTML'inizdeki `<span>`'nin kendisini hedefleyelim.
              // Eğer `div[data-testid="user-bio"]` yoksa, direkt olarak `section` içindeki biyografi elementini bulalım.
              const bioElement = document.querySelector('section span[dir="auto"] > div[role="button"] > span[dir="auto"]');
              // Alternatif ve daha genel bir seçici (manuel kontrol gerektirir):
              // const bioElement = document.querySelector('div[data-testid="user-bio"] span, span[data-bloks-name="ig-text"][dir="auto"]');

              const bio = bioElement ? bioElement.textContent.trim() : ''; // trim() ile başındaki ve sonundaki boşlukları temizle

              // Yeni Kural: Biyografi Metin Uzunluğu Kontrolü
              // Bio varsa ve uzunluğu 30 karakterden fazlaysa işletme olarak kabul et
              if (bio && bio.length > 30) {
                isBusinessAccount = true;
              }

              // İşletme anahtar kelimeleri kontrolü (önceki yanıttan)
              const businessKeywords = ['cafe', 'restoran', 'otel', 'mağaza', 'şirket', 'firma', 'butik', 'salon', 'stüdyo', 'eğitim', 'servis', 'hizmet', 'mutfak', 'pizza', 'döner', 'berber', 'kuaför', 'bar', 'pub'];
              if (bio && businessKeywords.some(keyword => bio.toLowerCase().includes(keyword))) {
                isBusinessAccount = true;
              }

              // Takipçi sayısını al (bu kısım genellikle stabil ve değiştirilmedi)
              let followers = 0;
              const followerElements = document.querySelectorAll('a[href$="/followers/"] span[title], a[href$="/followers/"] span, li[class*="x78zum5"] > span > span');

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
                    break;
                  }
                }
              }

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
            // Hata durumunda döngünün devam etmesi için continue daha uygun.
            continue;
          }
        }

        // Daha fazla gönderi yüklemek için aşağı kaydır
        await this.page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });

        await this.safeWait(3000); // Kaydırma sonrası yüklenmesi için bekle
        scrollAttempts++;
        console.log(`Scrolled down. Scroll attempt: ${scrollAttempts}/${maxScroll}. Found ${businessAccounts.length} business accounts so far.`);
      }

      console.log(`🎯 Search completed. Found ${businessAccounts.length} business accounts`);
      return businessAccounts;

    } catch (error) {
      console.error('❌ Search failed overall:', error);
      throw error;
    }
  }

  async close() {
    try {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.page = null;
        this.isLoggedIn = false;
        console.log('🔒 Browser closed');
      }
    } catch (error) {
      console.error('❌ Error closing browser:', error);
    }
  }
}

module.exports = InstagramScraper;