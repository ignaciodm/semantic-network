import { LinkedRepresentation, LinkUtil, RelationshipType } from 'semantic-link';
import anylogger from 'anylogger';
import { PooledCollectionOptions } from '../interfaces/pooledCollectionOptions';
import { ResourceResolver } from '../interfaces/resourceResolver';
import LinkRelation from '../linkRelation';
import PooledResourceUtil from './pooledResourceUtil';

const log = anylogger('PooledResource');

/**
 * On locating a sub resource, a select on a form provides the 'name' with a value which is the key of the sub resource
 * that is used to resolve the resource itself via a known link relation
 */
export type RelName = string;
export type PooledResourceResolver = <T extends LinkedRepresentation>(resource: T, options?: PooledCollectionOptions) => Promise<T | undefined>;
const noopUndefined = async () => undefined;

export abstract class PooledResource<T extends LinkedRepresentation> {
    /**
     * the home resource (or starting point) of the sub collections
     */
    protected contextResource: T | undefined;

    /**
     * A set of resolvers that map between the originating resource (eg a singleton item) to its containing resource
     * (eg a collection) in order to sync inside its containing resource on the pooled collection.
     *
     * Note: these resolvers are set in the implementing class via {@link makeResolvers}
     */
    protected resolvers: Record<RelName, PooledResourceResolver>;

    public constructor(resource: T) {
        if (!resource) {
            log.error('empty resource for pooled resources');
        }

        this.contextResource = resource;

        this.resolvers = this.makeResolvers();
    }

    public get resourceResolver(): ResourceResolver {
        return this.pooledResource.bind(this);
    }

    /**
     *
     * @param rel known link relation of the resource resolved on the pooled resource context
     * @param options
     */
    protected resolve(rel: RelationshipType, options?: PooledCollectionOptions): PooledResourceResolver {

        // initialise on entry as resolver is not scoped on inner function
        const { pooledResolver } = { ...options };

        return async <T extends LinkedRepresentation>(document: T, options?: PooledCollectionOptions): Promise<T | undefined> => {
            log.debug('resolve pooled %s %s', rel, LinkUtil.getUri(document, LinkRelation.Self));
            if (this.contextResource) {
                const resource = await PooledResourceUtil.sync(
                    this.contextResource,
                    document as LinkedRepresentation,
                    { ...options, rel });

                /*
                 * process nested sync
                 */
                if (resource) {
                    pooledResolver?.(resource, document, options);
                }

                return resource as T;
            }

        };
    }

    /**
     * Set of resolvers returning the sub collections
     */
    protected abstract makeResolvers(): Record<string, PooledResourceResolver>;

    /**
     * Default resolves returns a noop undefined
     */
    protected defaultPooledResolver: (type: string) => PooledResourceResolver = () => noopUndefined;

    /**
     * Access back to the keyed resolver
     */
    private pooledResource(type: string): PooledResourceResolver {
        if (this.resolvers[type]) {
            log.debug('resolving resource pool type: %s', type);
            return this.resolvers[type];
        } else {
            return noopUndefined;
        }
    }
}
