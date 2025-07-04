import { ClusterOptions } from "ioredis/built/cluster/ClusterOptions";
import { ClusterNode } from "ioredis/built/cluster";
import { Cluster } from "ioredis";
import { logger as defaultLogger } from "./logger";
import { ILogger, RedisClusterPoolOptions } from "./types";
import type { Options as PoolOptions } from 'generic-pool';
import genericPool from "generic-pool";


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
        this.pool = this.createClusterPool(
            options.startupNodes!,
            options.pool,
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


    private createClusterPool(
        startupNodes: ClusterNode[],
        poolOptions: PoolOptions,
        redisOptions?: ClusterOptions
    ): genericPool.Pool<Cluster> {
        let context = this;
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
                            } else {
                                this.logger.info('The connection is established to the Redis server.');
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
}

export default RedisClusterPool;
