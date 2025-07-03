import genericPool from 'generic-pool';
import Redis, { Cluster } from 'ioredis';

import { logger as defaultLogger } from './logger';
import { ILogger, PoolOptions, RedisClusterPoolOptions, RedisOptions, RedisPoolOptions } from './types';
import { ClusterOptions } from "ioredis/built/cluster/ClusterOptions";
import { ClusterNode } from "ioredis/built/cluster";


function createClusterPool(
    startupNodes: ClusterNode[],
    poolOptions: PoolOptions,
    context: RedisClusterPool,
    redisOptions?: ClusterOptions
): genericPool.Pool<Cluster> {
  return genericPool.createPool({
    create(): Promise<Cluster> {
      return new Promise<Cluster>((resolve, reject) => {
        const ioredis = new Cluster(startupNodes, redisOptions);

        const onError = (e: Error) => {
          context.logger.error('Create redis connection error.', e);
          ioredis.disconnect();
          reject(e);
        };

        ioredis
            .once('error', onError)
            .once('ready', () => {
              ioredis.off('error', onError);
              if (ioredis.options.enableReadyCheck) {
                context.logger.info('Redis Server is ready.');
              }
              else {
                context.logger.info('The connection is established to the Redis server.');
              }
              resolve(ioredis);
            });
      });
    },

    destroy(ioredis: Cluster): Promise<void> {
      return new Promise((resolve) => {
        ioredis
            .once('end', () => {
              context.logger.info('No more reconnections will be made.');
              resolve();
            })
            .disconnect();
      });
    }
  }, poolOptions);
}

function createPool(
  redisOptions: RedisOptions | undefined,
  poolOptions: PoolOptions,
  context: RedisPool
): genericPool.Pool<Redis> {
  return genericPool.createPool({
    create(): Promise<Redis> {
      return new Promise((resolve, reject) => {
        const ioredis = new Redis(redisOptions as any);

        const onError = (e: Error) => {
          context.logger.error('Create redis connection error.', e);
          ioredis.disconnect();
          reject(e);
        };

        ioredis
          .once('error', onError)
          .once('ready', () => {
            ioredis.off('error', onError);
            if (ioredis.options.enableReadyCheck) {
              context.logger.info('Redis Server is ready.');
            }
            else {
              context.logger.info('The connection is established to the Redis server.');
            }
            resolve(ioredis);
          });
      });
    },

    destroy(ioredis: Redis): Promise<void> {
      return new Promise((resolve) => {
        ioredis
          .once('end', () => {
            context.logger.info('No more reconnections will be made.');
            resolve();
          })
          .disconnect();
      });
    }
  }, poolOptions);
}

/**
 * A pool of redis connections.
 *
 * @class RedisPool
 * @extends EventEmitter
 * @param {RedisPoolOptions} options - The options for the pool.
 * @param {RedisOptions} options.redis - The options for the redis client.
 * @param {PoolOptions} options.pool - The options for the pool.
 * @param {ILogger} options.logger - The logger to use.
 * @example
 * ```ts
  const pool = new RedisPool({
    redis: {
      host: '127.0.0.1', // Redis host
      port: 6379, // Redis port
      name: 'test',
      password: 'B213547b69b13224',
      keyPrefix: 'test_'
    },
    pool: {
      // Set the pool's size
      min: 2,
      max: 10
    }
  });

  async function todo() {
    let client;
    try {

      // get a connection for redis
      client = await pool.getConnection();

      // save something to redis
      client.set('test', 'test redis');

      // get something from redis
      const result = await client.get('test');
      console.info('saved successfully', result);

      // delete something from redis
      client.del('test');
      console.info('deleted successfully', result);
    }
    catch (e) {
      // caught an error
      console.error(e);
    }
    finally {
      // finally release redis client to pool
      if (client) {
        await pool.release(client);
        console.info('released');
      }
    }

    // close connection with redis
    await pool.end();
  }

  todo();
 * ```
 */
class RedisPool {
  static defaults = {
    pool: {
      min: 2,
      max: 10
    },
    customLogger: defaultLogger
  };

  logger: ILogger;
  pool: genericPool.Pool<Redis>;
  constructor(opts: Partial<RedisPoolOptions>) {
    const options = Object.assign({}, RedisPool.defaults, opts);

    this.logger = options.customLogger;
    this.pool = createPool(
      options.redis,
      options.pool,
      this
    );
  }

  /**
   * Get a connection from the pool
   */
  getConnection(priority?: number): Promise<Redis> {
    return this.pool.acquire(priority);
  }

  /**
   * Release a redis connection
   */
  release(client: Redis): Promise<void> {
    return this.pool.release(client);
  }

  /**
   * Close a redis connection
   */
  disconnect(client: Redis): Promise<void> {
    return this.pool.destroy(client);
  }

  /**
   * Close all connections
   */
  end(): Promise<void> {
    return this.pool.drain()
      .then(() => this.pool.clear())
      .then(() => {
        this.logger.info('Disconnected all Redis connections.');
      });
  }
}

class RedisClusterPool {
  static defaults = {
    pool: {
      min: 2,
      max: 10
    },
    customLogger: defaultLogger
  };

  logger: ILogger;
  pool: genericPool.Pool<Cluster>;
  constructor(opts: Partial<RedisClusterPoolOptions>) {
    const options = Object.assign({}, RedisClusterPool.defaults, opts);

    this.logger = options.customLogger;
    this.pool = createClusterPool(
        options.startupNodes!,
        options.pool,
        this,
        options.redisOptions
    );
  }

  /**
   * Get a connection from the pool
   */
  getConnection(priority?: number): Promise<Cluster> {
    return this.pool.acquire(priority);
  }

  /**
   * Release a redis connection
   */
  release(client: Cluster): Promise<void> {
    return this.pool.release(client);
  }

  /**
   * Close a redis connection
   */
  disconnect(client: Cluster): Promise<void> {
    return this.pool.destroy(client);
  }

  /**
   * Close all connections
   */
  end(): Promise<void> {
    return this.pool.drain()
        .then(() => this.pool.clear())
        .then(() => {
          this.logger.info('Disconnected all Redis connections.');
        });
  }
}

export {
  Redis,
  RedisPool,
  RedisClusterPool
};

export * from './types';
