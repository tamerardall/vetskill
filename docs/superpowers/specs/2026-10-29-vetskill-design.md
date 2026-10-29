# vetskill — Tasarım

- **Tarih:** 2026-10-29
- **Durum:** Onaylandı (2026-10-29)
- **Repo:** `tamerardall/vetskill` (MIT)

## 1. Amaç

Kullanıcı kelimeyi tam bilmeden, doğal dille ihtiyacını anlatır ("pdf'leri birleştirmek istiyorum"). vetskill en uygun 2–3 skill'i gerekçesiyle önerir ve her birini kurmadan önce statik güvenlik taramasından geçirip bulguları gösterir. Kurulumu yapmaz; karar kullanıcıdadır.

Tek cümle: **Doğru skill'i bul, kurmadan önce ne yaptığını gör.**

Proje sahibinin hedefleri: açık kaynakta görünürlük ve Claude Code / agent skills ekosisteminde yer edinmek.

## 2. Arka plan ve kanıt

`npx skills find` (vercel-labs/skills, `src/find.ts`) aramayı skills.sh API'sine (`/api/search`, Algolia fuzzy) devreder. API sonuçları alaka sırasıyla döner; CLI bunları kurulum sayısına göre yeniden sıralar. Ölçülen etki (2026-10-29):

- `deploy`: API'nin 1. sonucu `deploy-to-vercel`, CLI'da 20 sonuç içinde 17. sıraya düşer; CLI'ın 1. sonucu (`microsoft-foundry`) sorguyu içermez.
- `pdf`: `docx` ve `canvas-design` 2–3. sıraya çıkar.

Upstream'de bu sorun için açık PR'lar var (#2432, #2457, #1312); proje sahibi #2432'ye bu kanıtla yorum yazdı. API sonuçlarında açıklama (description) alanı yoktur, bu yüzden CLI çıktısı yalnızca isimle karar vermeye zorlar.

### Rakipler

| Skill | Ne yapar | vetskill'den farkı |
|---|---|---|
| `maverickemanuel/trusted-skill-scout` | `npx skills find` ile arar, kur | "Güven" = ≥100 kurulum ve ≥500 yıldız; içerik taranmaz; kurulum sayısına göre sıralar |
| `affaan-m/ecc` → `skill-scout` | Yeni skill yazmadan önce benzerini arar | Amaç farklı; deterministik tarama yok |

vetskill'in iki farkı: **alaka sırasını korur ve çoklu sorguyu birleştirir**; **içeriği ajan görmeden deterministik bir script tarar.**

## 3. Kapsam

### Kapsamda
- Niyetten çoklu sorgu üretimi (ajan), skills.sh API araması, sonuç birleştirme (script).
- GitHub kaynaklı skill'lerin klasör içeriğini çekme ve statik kurallarla tarama.
- Ajana yalnızca temizlenmiş JSON verilmesi; ajanın 2–3 öneriyi gerekçe ve bulgularla sunması.

### Kapsam dışı
- Kurulum (`npx skills add` komutu yalnızca gösterilir).
- AST / veri akışı analizi, script çalıştırma, sandbox.
- GitHub dışı kaynaklar (well-known, HuggingFace vb.). Bu adaylar listelenir ama SS-08 "desteklenmeyen kaynak" bulgusuyla taranmamış olarak işaretlenir.
- Ayrı npm paketi / bağımsız CLI dağıtımı.

## 4. Mimari

```
vetskill/
├── skills/vetskill/
│   ├── SKILL.md            # ajan talimatları
│   └── scripts/scan.mjs    # bağımlılıksız, Node 18+ (yerleşik fetch)
├── tests/                  # node:test
├── docs/superpowers/specs/
├── README.md, README.tr.md, LICENSE
```

Kurulum: `npx skills add tamerardall/vetskill`. Node, `npx skills` için zaten gereklidir; ek kurulum yoktur.

### SKILL.md kuralları
- Frontmatter `description` "Use when…" ile başlar, yalnızca tetiklenme koşullarını anlatır (skill arama, "is there a skill for X", skill kurmadan önce güvenlik sorusu); süreci özetlemez. 500 karakterin altında.
- Script her zaman yorumlayıcıyla çağrılır: `node scripts/scan.mjs …` (bazı paketleyiciler çalıştırma izinlerini siler).
- Gövde 500 kelimenin altında; bayrak ayrıntıları `node scripts/scan.mjs --help` çıktısındadır.

### Neden script?
Kötü niyetli bir SKILL.md'yi ajanın okuması, içindeki prompt injection'ı ajanın bağlamına sokar. Görünmez Unicode'u LLM güvenilir şekilde göremez. Bu yüzden ham içerik yalnızca script'te işlenir; ajan sadece script'in ürettiği JSON'u görür. SKILL.md, ajana aday dosyalarını kendisi `curl`/WebFetch ile okumamasını açıkça söyler.

## 5. Veri akışı

1. **Ajan niyeti çözer.** Kullanıcı isteğinden 3–5 İngilizce sorgu üretir (eş anlamlılar, Türkçe isteğin karşılıkları, genelden özele).
2. **Script arar.** `node scan.mjs --query "merge pdf" --query "pdf" [--top 10]`. Her sorgu için `GET https://skills.sh/api/search?q=<q>&limit=20`. `SKILLS_API_URL` ortam değişkeni taban adresi değiştirir.
3. **Script birleştirir.** Adaylar `id` ile tekilleştirilir. Puan Reciprocal Rank Fusion ile hesaplanır: `score = Σ 1 / (10 + rank)` (rank 1'den başlar, adayın çıktığı her sorgu için). Eşitlikte `installs` büyük olan önce gelir. İlk `--top` (varsayılan 10) aday taranır.
4. **Script içeriği çeker.** Her farklı `source` (`owner/repo`) için tek bir `GET /repos/{owner}/{repo}/git/trees/HEAD?recursive=1` isteği atılır. Skill klasörü, yolu `<dir>/SKILL.md` olan ve `<dir>`'in son parçası `skillId`'ye eşit olan girdidir; yoksa kök `SKILL.md` (tek skill'lik repo) denenir; o da yoksa SS-08 "skill klasörü bulunamadı". Klasördeki dosyalar `raw.githubusercontent.com/{owner}/{repo}/HEAD/<path>` üzerinden çekilir (API hız sınırına sayılmaz).
5. **Script tarar ve temizler.** Bölüm 6'daki kurallar her dosyada çalışır. `description` frontmatter'dan okunur, görünmez/kontrol karakterleri silinir, 300 karaktere kısaltılır.
6. **Script JSON yazar** (stdout, bkz. 5.1). Çıkış kodu: başarıda 0, arama tamamen başarısızsa 2, kullanım hatasında 1.
7. **Ajan sıralar ve sunar.** JSON'daki açıklamalara göre niyete en uygun 2–3 adayı seçer. Her biri için: ad, kaynak, kurulum sayısı, neden uygun olduğu (1–2 cümle), bulgular (önem + kural + dosya:satır + ajan yorumu), `npx skills add <source>@<name>` komutu. Bulgu yoksa "taranan dosyalarda bulgu yok" der, asla "güvenli" demez.

### 5.1 JSON çıktısı

```json
{
  "queries": ["merge pdf", "pdf"],
  "error": null,
  "warnings": [],
  "candidates": [
    {
      "id": "anthropics/skills/pdf",
      "source": "anthropics/skills",
      "name": "pdf",
      "installs": 123456,
      "score": 0.18,
      "matchedQueries": ["merge pdf", "pdf"],
      "description": "…",
      "scannedFiles": 4,
      "findings": [
        { "rule": "SS-03", "severity": "medium", "file": "scripts/x.py", "line": 12, "message": "reads ~/.ssh" }
      ]
    }
  ]
}
```

`error` yalnızca tüm sorgular başarısız olduğunda doludur (ör. `"search API unreachable: timeout"`); bu durumda `candidates` boştur. Bazı sorgular başarısızsa diğerlerinin sonuçları döner ve `warnings` dizisi başarısız sorguları listeler.

## 6. Güvenlik kuralları

| ID | Ne arar | Önem |
|---|---|---|
| SS-01 | Bidi kontrol (U+202A–202E, U+2066–2069) ve Unicode tag karakterleri (U+E0000–E007F): yüksek. Sıfır genişlikli (U+200B–200D, U+2060, dosya başı dışındaki U+FEFF): orta | yüksek / orta |
| SS-02 | `curl`/`wget` çıktısının `sh`/`bash`/`zsh`'e aktarılması, `eval "$(curl …)"`, `iex (iwr …)` / `Invoke-Expression` + indirme | yüksek |
| SS-03 | `~/.ssh`, `id_rsa`, `id_ed25519`, `~/.aws/credentials`, `.env`, tarayıcı çerez/profil dizinleri, macOS keychain | orta |
| SS-04 | Ham IP adresine HTTP istekleri; `webhook.site`, `ngrok`, `pastebin.com`, `discord.com/api/webhooks`, `requestbin` | orta |
| SS-05 | Prompt injection kalıpları: "ignore (all )?previous instructions", "do not tell the user", "without asking the user", "disregard (the )?system prompt" (büyük/küçük harf duyarsız) | orta |
| SS-06 | 200+ karakterlik base64 blokları, `eval(atob(`, `exec(base64`, `base64 -d \| sh` | orta |
| SS-07 | Frontmatter `allowed-tools` içinde kısıtsız `Bash` veya `*` | bilgi |
| SS-08 | Taranamayan içerik: ikili dosya, 256 KB üstü dosya, skill başına 30 dosya sınırını aşan kısım, çekilemeyen dosya, desteklenmeyen kaynak, hız sınırı | bilgi |

İlkeler:
- Araç hiçbir zaman "güvenli" demez. Statik tarama kararlı bir saldırganı yakalayamaz; bu sınır README'de yazılıdır.
- Her bulgu dosya, satır ve kural ID'si taşır. Ajan bağlamı yorumlayabilir (ör. deploy skill'inde `.env` beklenir) ama bulguyu gizlemez.
- Bulgu mesajları sabit metinlerdir; dosyadan alıntı içermez (injection'ın JSON üzerinden ajana sızmaması için).

## 7. Hata durumları

- **Arama başarısız ≠ sonuç yok.** Tüm sorgular başarısızsa `error` dolar, çıkış kodu 2; ajan "arama servisine ulaşılamadı" der.
- **Zaman aşımı:** her istek `AbortSignal.timeout(10_000)`. **Eşzamanlılık:** en fazla 4 istek aynı anda.
- **GitHub kimlik doğrulaması:** `GITHUB_TOKEN` ortam değişkeni, yoksa `gh auth token` çıktısı, o da yoksa token'sız (saatte 60 istek). 403/429'da etkilenen adaylar SS-08 "hız sınırı" ile işaretlenir, listeden çıkarılmaz; ajan `gh auth login` önerir.
- **Kısmi hatalar işi durdurmaz;** her aday bağımsız işlenir.

## 8. Test

- `node --test`; dış bağımlılık yok. `fetch` fonksiyonu enjekte edilir, testlerde ağ çağrısı yapılmaz.
- Her kural için **kötü** (yakalanmalı) ve **masum** (yakalanmamalı) fixture: ör. deploy dokümanında `.env`'den bahsetme, README'de normal `curl -O` kurulum adımı, kısa base64 sabit.
- Gizli Unicode fixture'ları dosyaya ham yazılmaz; test sırasında escape dizilerinden üretilir.
- Birleştirme testleri: RRF puanı, tekilleştirme, eşitlikte `installs`, kısmi sorgu hatası → `warnings`, tüm hata → `error` + çıkış 2.
- İçerik çekme testleri: skill klasörü bulma (alt klasör, kök SKILL.md, bulunamadı), boyut/dosya sınırları, 403 → SS-08.
- **SKILL.md, RED-GREEN-REFACTOR ile yazılır (superpowers:writing-skills).** RED: skill olmadan subagent'lara senaryolar verilir, davranış kelimesi kelimesine kaydedilir (beklenen hatalar: `npx skills find` sıralamasına güvenmek, aday SKILL.md'leri doğrudan okumak, "güvenli" demek). GREEN: SKILL.md yalnızca gözlenen hataları hedefler; aynı senaryolar skill ile tekrar çalıştırılır. REFACTOR: yeni kaçamaklar kapatılır, tekrar test edilir.
- **Ajan senaryoları:** "pdf'leri birleştir", "vercel'e deploy et", "commit mesajı yaz", "react performansını artır". Ölçüt: beklenen skill ilk 3 öneride; her öneride gerekçe ve tarama sonucu var.

## 9. Yayın ve görünürlük

- README girişi: `deploy` önce/sonra örneği (CLI'da 17. sıra → vetskill'de ilk öneri + tarama raporu), "Neden başka bir araç?" bölümü (Bölüm 2 rakip tablosu), kural tablosu, sınırlar.
- `README.tr.md` Türkçe karşılık.
- Dışa dönük adımlar ayrıca onay gerektirir: GitHub repo oluşturma/push, #2432 tartışmasına bağlantı, LinkedIn duyurusu.

## 10. Başarı ölçütleri

1. Bölüm 8'deki dört senaryonun her birinde beklenen skill ilk 3 öneride.
2. Her kuralın kötü fixture'ı yakalanıyor, masum fixture'ı yakalanmıyor.
3. Ajan hiçbir adımda aday dosyalarının ham içeriğini okumuyor.
4. `npx skills add tamerardall/vetskill` ile kurulup ek adım olmadan çalışıyor.
