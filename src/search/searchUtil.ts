import { CollectionRepresentation, LinkedRepresentation, LinkUtil } from 'semantic-link';
import { ApiOptions } from '../interfaces/apiOptions';
import { instanceOfTrackedRepresentation } from '../utils/instanceOf/instanceOfTrackedRepresentation';
import { instanceOfCollection } from '../utils/instanceOf/instanceOfCollection';
import {
    pooledCollectionMakeStrategy,
    SparseRepresentationFactory,
} from '../representation/sparseRepresentationFactory';
import { SingletonMerger } from '../representation/singletonMerger';
import anylogger from 'anylogger';
import { create } from '../representation/create';
import { DocumentRepresentation } from '../interfaces/document';
import { CollectionMerger } from '../representation/collectionMerger';
import { ApiUtil } from '../apiUtil';
import { LinkRelation } from '../linkRelation';
import ResourceUtil from '../utils/resourceUtil';

const log = anylogger('SearchUtil');

export default class SearchUtil {

    /**
     * Create or get a tracked resource that is a collection to store search collections. It
     * is likely (but not required) that the resource is backed by a 'real' resource.
     *
     * This can be used to store search results in an ad-hoc manner where the search
     * result doesn't have to have a name. The 'self' link of the search result can be used
     * to identify what the search was (and should be unique).
     */
    public static makePooledCollection<T extends LinkedRepresentation,
        TKey extends keyof T & string,
        TResult extends LinkedRepresentation>(
        context: T,
        options?: ApiOptions): CollectionRepresentation<TResult> {
        if (instanceOfTrackedRepresentation(context)) {
            const { rel = undefined } = { ...options };
            if (rel) {
                const uri = LinkUtil.getUri(context, rel);
                if (uri) {
                    const poolName = ResourceUtil.makeName(options) as TKey;
                    const pool = context[poolName] as unknown as CollectionRepresentation<TResult>;
                    if (pool) {
                        if (instanceOfTrackedRepresentation(pool)) {
                            if (instanceOfCollection(pool)) {
                                return pool;
                            } else {
                                throw new Error(`Pool '${poolName}' is not a collection`);
                            }
                        } else {
                            throw new Error(`Attribute '${poolName}' is not a tracked resource`);
                        }
                    } else {
                        const newSearches = SparseRepresentationFactory.make<CollectionRepresentation<TResult>>(
                            { ...options, sparseType: 'collection', uri: uri });
                        SingletonMerger.add(context, poolName, newSearches, options);
                        return newSearches;
                    }
                } else {
                    throw new Error(`Link relation '${rel}' not found`);
                }
            } else {
                throw new Error(`The pool collection requires a link relation`);
            }
        }
        throw new Error(`Failed to create pool collection`);
    }

    /**
     *
     * Return a search result collection that is a tracked resource collection on the context collection.
     *
     * Each time this is called the new search result is merged into the search result collection that can
     * be bound to the view.
     *
     * With each call, the pooled search collection will use existing items or fetch new ones to minimise the
     * across the wire calls.
     *
     * @param context resource that has the search collection as a link relation
     * @param document the search fields that will be used for the search (and is merged into the create/search form)
     * @param options
     */
    public static async search<T extends LinkedRepresentation = LinkedRepresentation>(
        context: CollectionRepresentation<T>,
        document: DocumentRepresentation,
        options?: ApiOptions): Promise<CollectionRepresentation<T>> {

        const {
            searchRel = LinkRelation.Search,
            searchName = undefined,
            searchPooledPrefix = '.pooled-',
        } = { ...options };

        const pooledResource = SearchUtil.makePooledCollection(context, {
            ...options,
            rel: searchRel,
            name: searchName || `${searchPooledPrefix}${searchRel}`,
        });
        const searchResource = await ApiUtil.get(context, {
            ...options,
            rel: searchRel,
        }) as CollectionRepresentation<T>;

        const results = await create(
            document,
            {
                createContext: searchResource,
                makeSparseStrategy: (options) => pooledCollectionMakeStrategy(pooledResource, options),
            }) as CollectionRepresentation;

        if (results) {
            CollectionMerger.merge(searchResource, results);
        } else {
            log.debug('no search results available');
        }

        return searchResource;
    }

}
