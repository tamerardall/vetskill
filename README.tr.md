<p align="center"><img src="assets/logo.svg" width="96" alt="vetskill logosu"></p>

# vetskill

[English](README.md) · **Türkçe**

Doğru skill'i bul, kurmadan önce ne yaptığını gör.

vetskill bir ajan skill'idir. İhtiyacını herhangi bir dilde, düz cümleyle anlatırsın ("PDF dosyalarını birleştirmek istiyorum"). vetskill [skills.sh](https://skills.sh) üzerinde arama yapar, adayları niyetine ne kadar uyduklarına göre sıralar ve her adayın dosyalarını statik olarak tarar. 1–3 öneri alırsın. Her önerinin yanında bulguları ve kurulum komutu yer alır. vetskill hiçbir şey kurmaz. Kararı sen verirsin, komutu da sen çalıştırırsın.

## Örnek

Sorgu: `deploy`.

**`npx skills find deploy`** yalnızca eşleşmeleri listeler. Skill'lerin dosyalarını okumaz, bu yüzden bir adayın içinde ne olduğunu söyleyemez. (`skills` 1.7.4'e kadar API'nin alaka sırasını kurulum sayısına göre yeniden sıralıyordu ve `deploy-to-vercel` 20 sonuç içinde 17. sıraya düşüyordu. Bu 1.7.5'te düzeltildi: [vercel-labs/skills#2432](https://github.com/vercel-labs/skills/pull/2432).)

**vetskill** önce `deploy-to-vercel` önerir ve dosyalarını tarar. Aşağıda `node skills/vetskill/scripts/scan.mjs --query deploy --query "deploy vercel" --top 5` çıktısından kısaltılmış bir bölüm var:

```json
{
  "queries": ["deploy", "deploy vercel"],
  "error": null,
  "warnings": [],
  "candidates": [
    {
      "id": "vercel-labs/agent-skills/deploy-to-vercel",
      "installs": 174829,
      "score": 0.1818,
      "matchedQueries": ["deploy", "deploy vercel"],
      "description": "Deploy applications and websites to Vercel. Use when the user requests deployment actions like \"deploy my app\", …",
      "scannedFiles": 1,
      "findings": []
    },
    {
      "id": "vercel-labs/agent-skills/vercel-cli-with-tokens",
      "installs": 140378,
      "score": 0.1193,
      "scannedFiles": 1,
      "findings": []
    }
  ]
}
```

Ajan bunu şöyle sunar:

> **deploy-to-vercel** · `vercel-labs/agent-skills` · 174.829 kurulum
> Neden uygun: Açıklaması "Deploy applications and websites to Vercel". İstekle doğrudan örtüşüyor.
> Bulgular: Taranan dosyalarda bulgu yok (1 dosya tarandı).
> Kurulum: `npx skills add vercel-labs/agent-skills@deploy-to-vercel`

## Kurulum

```bash
npx skills add tamerardall/vetskill
```

Ya da Claude Code'da plugin olarak kur:

```
/plugin marketplace add tamerardall/vetskill
/plugin install vetskill@vetskill
```

Node 18 veya üstü gerekir. Başka bağımlılık yok.

İsteğe bağlı: `gh auth login` çalıştır (ya da `GITHUB_TOKEN` tanımla). Token olmadan GitHub saatte 60 API isteğine izin verir. Bu sınıra takılan adaylar taranmaz, SS-08 "hız sınırı" bulgusuyla gösterilir.

## Nasıl çalışır

1. Ajan isteğini 3–5 İngilizce arama sorgusuna çevirir.
2. `scripts/scan.mjs` her sorgu için skills.sh API'sini çağırır. Sonuçları Reciprocal Rank Fusion ile birleştirir (`score = Σ 1 / (10 + rank)`). Böylece alaka sırası korunur, kurulum sayısı yalnızca eşitliği bozar.
3. Script ilk adayların (varsayılan 10) skill klasörünü GitHub'dan çeker ve aşağıdaki kuralları her dosyada çalıştırır. Bulgu mesajları sabit metinlerdir, dosya içeriğinden alıntı içermez.
4. Script JSON yazar ve ajan yalnızca bu JSON'u okur. Niyetine uyan 1–3 adayı seçer, her birinin bulgularını gösterir. Taranamayan kısımlar da bu bulgulara dahildir.

**Ajan, adayın ham SKILL.md, README, script veya skills.sh sayfasını hiç okumaz.** Bu metinleri yabancılar yazar, içlerinde prompt injection olabilir. Modelin güvenilir şekilde göremediği görünmez Unicode karakterler de içerebilirler. Bu dosyaları yalnızca script okur. JSON'a temizlenerek ulaşan birkaç üçüncü taraf metni vardır: skills.sh'teki `id`, `source` ve `name` (katı kalıplara uymayan adaylar atılır), bulgulardaki dosya yolları (harf, rakam, boşluk ve `._/@+-` dışındaki karakterler `?` olur, en fazla 200 karakter) ve frontmatter `description` alanı (kontrol ve gizli karakterler silinir, 300 karaktere kısaltılır). Bunlar yine de yabancıların yazdığı kelimeler içerebilir. Bu yüzden skill, ajana bu alanlardaki talimatlara asla uymamasını söyler.

## Kurallar

| ID | Ne arar | Önem |
|---|---|---|
| SS-01 | Bidi kontrol karakterleri (U+202A–202E, U+2066–2069) ve Unicode tag karakterleri (U+E0000–E007F): yüksek. Sıfır genişlikli karakterler (U+200B–200D, U+2060, dosya başı dışındaki U+FEFF): orta | yüksek / orta |
| SS-02 | `curl`/`wget` çıktısının `sh`/`bash`/`zsh`'e aktarılması (`sudo` ile de), `bash <(curl …)`, `sh -c "$(curl …)"`, `eval "$(curl …)"`, `iex (iwr …)` / `Invoke-Expression` ile indirme | yüksek |
| SS-03 | `~/.ssh`, `id_rsa`, `id_ed25519`, `~/.aws/credentials`, tarayıcı çerez/profil dizinleri, macOS keychain her dosyada; `.env` yalnızca Markdown dışı dosyalarda | orta |
| SS-04 | Ham IP adresine HTTP istekleri; `webhook.site`, `ngrok`, `pastebin.com`, `discord.com/api/webhooks`, `requestbin` | orta |
| SS-05 | Prompt injection kalıpları: "ignore (all) previous/prior/above instructions", "do not tell the user", "without asking the user", "disregard (the) system prompt" (büyük/küçük harf duyarsız) | orta |
| SS-06 | 200+ karakterlik base64 blokları, `eval(atob(`, `exec(base64`, `base64 -d \| sh` | orta |
| SS-07 | Frontmatter `allowed-tools` içinde kısıtsız `Bash` veya `*` | bilgi |
| SS-08 | Taranamayan içerik: ikili dosya, 256 KB üstü dosya, 30 dosya sınırını aşan kısım, çekilemeyen dosya veya skill, bulunamayan skill klasörü, hız sınırı | bilgi |

**`.env` neden Markdown'da işaretlenmez:** Bir deploy skill'inin dokümanında "`VERCEL_TOKEN` değerini `.env` dosyana yaz" demesi beklenen ve zararsız bir durumdur. `.env` dosyasını açan bir script ise incelemeye değer. Anahtar ve kimlik bilgisi yolları her dosyada işaretlenir.

Bulgu bir hüküm değildir, bir satırı gösterir. Statik bir eşleşme tamamen meşru olabilir. Ajan bağlamı açıklar ama bulguyu asla gizlemez.

## Neden bir araç daha?

| Araç | Ne yapar | vetskill'den farkı |
|---|---|---|
| `npx skills find` | skills.sh'te arar | Yalnızca eşleşmeleri listeler. Dosyaları taramaz ya da okumaz, bu yüzden kurmadan önce bulgu göremezsin. |
| `maverickemanuel/trusted-skill-scout` | `npx skills find` ile arar ve kurar | "Güven" ≥100 kurulum ve ≥500 yıldız demektir. İçerik taranmaz, popülerliğe göre sıralar. |
| `affaan-m/ecc` → `skill-scout` | Yeni skill yazmadan önce benzerini arar | Amacı farklı. Deterministik tarama yok. |
| skills.sh denetim rozetleri (Gen Agent Trust Hub, Socket, Snyk) | skills.sh sayfasında gösterilen üçüncü taraf denetimleri | Faydalı bilgilerdir, vetskill onların yerini almaz. |

vetskill'in kattıkları:

- **Karar anında, güncel dosyalarda.** Daha önceki bir denetimin yapıldığı anı değil, seçim yaptığın anda depoda bulunan dosyaları tarar.
- **Ajan ham aday içeriğini hiç okumaz.** vetskill'siz baz ölçümümüzde ajandan Vercel deploy skill'i bulması ve güvenli olup olmadığını söylemesi istendi. Ajan 5 çalıştırmanın 5'inde adayın SKILL.md dosyasını okudu. 5'inde de "büyük ölçüde evet" türünde bir hüküm verdi ("Mostly yes, with caveats", "Reasonably safe, with caveats"). vetskill ile her ikisi de 5'te 0. Bkz. [docs/baseline/2026-10-29-red.md](docs/baseline/2026-10-29-red.md) ve [docs/baseline/2026-10-29-green.md](docs/baseline/2026-10-29-green.md).
- **Dosya bazında bulgular ve açık SS-08.** Her bulgu kural ID'si ve dosya taşır, uygun olduğunda satır da taşır. Taranamayan her şey bu şekilde listelenir.
- **Niyete dayalı, çoklu sorgulu sıralama.** Birden çok sorgu alakaya göre birleştirilir. Ajan açıklamanın uyumuna göre seçer, kurulum sayısı yalnızca eşitliği bozar.

## Sınırlar

- **Statik tarama kararlı bir saldırganı yakalayamaz. Bulgu olmaması güvenli olduğu anlamına gelmez.** vetskill kalıp eşleştirir. Kod çalıştırmaz, veri akışını izlemez, sandbox kullanmaz. Hiçbir skill'e "güvenli" demez.
- Yalnızca GitHub'da barınan skill'ler taranır. Kaynağı GitHub `owner/repo` biçiminde olmayan ya da id veya adı beklenmeyen karakterler içeren arama sonuçları atılır.
- Skill başına en fazla 30 dosya, dosya başına en fazla 256 KB taranır. Kalanı SS-08 olarak bildirilir.
- 4096 karakterden uzun satırlar (örneğin küçültülmüş kod) yalnızca SS-01, SS-03 ve uzun base64 blokları için denetlenir.
- Arama skills.sh API'sine bağlıdır. Bazı sorgular başarısız olursa JSON bunları `warnings` içinde listeler ve sonuçlar eksik olabilir. Hepsi başarısız olursa `error` dolar.

## Geliştirme

```bash
npm test
```

## Lisans

[MIT](LICENSE) © 2026 Tamer Ardal
