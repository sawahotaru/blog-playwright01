import express, { Request, Response } from "express"

type Event = { type?: string; [k: string]: unknown }
interface WebhookBody { events?: Event[] }

const app = express()
// JSON本文をreq.bodyに入れる（必須ミドルウェア）
app.use(express.json())

// Params={}, ResBody=void, ReqBody=WebhookBodyの順
app.post<{}, void, WebhookBody>("/webhook",
  (req: Request<{}, void, WebhookBody>, res: Response) => {
    const events = req.body?.events ?? []

    res.status(200).end() // まず200

    // 応答後の軽い後処理（例：200ms）
    // 本番はキュー・ワーカーへ委譲を推奨
    for (const ev of events) setTimeout(() => { /* 後処理 */ }, 200)
  }
)

app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => {
  console.log(`listening on 0.0.0.0:${process.env.PORT ?? 3000}/webhook`)
})

