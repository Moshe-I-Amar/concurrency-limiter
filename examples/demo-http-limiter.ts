/**
 * Demo: HttpRequestLimiter
 *
 * Fires 6 requests to a public API with maxConcurrentRequests=2.
 * Watch the active/queued counters — never more than 2 in-flight.
 *
 * Run: npx ts-node examples/demo-http-limiter.ts
 */

import { HttpRequestLimiter } from '../src/index';

const MAX_REQUESTS = 2;
const POST_IDS = [1, 2, 3, 4, 5, 6];

const http = new HttpRequestLimiter({
  maxConcurrentRequests: MAX_REQUESTS,
  defaultInit: {
    headers: {
      'Accept': 'application/json',
    },
  },
});

interface Post {
  id: number;
  title: string;
  userId: number;
}

async function main() {
  console.log(`\nHttpRequestLimiter demo`);
  console.log(`  requests: ${POST_IDS.length}  |  maxConcurrentRequests: ${MAX_REQUESTS}\n`);

  const start = Date.now();

  const promises = POST_IDS.map(async id => {
    const { activeCount, queueLength } = http.stats;
    console.log(`  [post ${id}] enqueued | active: ${activeCount} | queued: ${queueLength}`);

    const response = await http.request(
      `https://jsonplaceholder.typicode.com/posts/${id}`
    );

    const post = await response.json() as Post;
    console.log(`  [post ${id}] done     | "${post.title.slice(0, 40)}..."`);
    return post;
  });

  const posts = await Promise.all(promises);
  const elapsed = Date.now() - start;

  console.log(`\nFetched ${posts.length} posts in ${elapsed}ms`);
  console.log(`Max concurrent requests was capped at ${MAX_REQUESTS}`);
}

main().catch(console.error);
