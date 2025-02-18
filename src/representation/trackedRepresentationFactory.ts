import { CollectionRepresentation, FeedRepresentation, LinkedRepresentation, LinkUtil, Uri } from 'semantic-link';
import { Tracked } from '../types/types';
import { Status } from './status';
import { ResourceLinkOptions } from '../interfaces/resourceLinkOptions';
import { HttpRequestOptions } from '../interfaces/httpRequestOptions';
import { SingletonMerger } from './singletonMerger';
import { LinkRelation } from '../linkRelation';
import { HttpRequestFactory } from '../http/httpRequestFactory';
import { TrackedRepresentationUtil } from '../utils/trackedRepresentationUtil';
import { HttpRequestError, isHttpRequestError } from '../interfaces/httpRequestError';
import { ResourceQueryOptions } from '../interfaces/resourceQueryOptions';
import { ResourceMergeOptions } from '../interfaces/resourceAssignOptions';
import { parallelWaitAll, sequentialWaitAll } from '../utils/promiseWaitAll';
import { CollectionMerger } from './collectionMerger';
import { SparseRepresentationFactory } from './sparseRepresentationFactory';
import { ResourceFetchOptions } from '../interfaces/resourceFetchOptions';
import { DocumentRepresentation } from '../interfaces/document';
import anylogger from 'anylogger';
import { RepresentationUtil } from '../utils/representationUtil';
import { ResourceFactoryOptions } from '../interfaces/resourceFactoryOptions';
import { State } from './state';
import { instanceOfTrackedRepresentation } from '../utils/instanceOf/instanceOfTrackedRepresentation';
import { instanceOfFeed } from '../utils/instanceOf/instanceOfFeed';
import { FormRepresentation } from '../interfaces/formRepresentation';
import { LoaderJobOptions } from '../interfaces/loader';
import { instanceOfCollection } from '../utils/instanceOf/instanceOfCollection';

const log = anylogger('TrackedRepresentationFactory');

export class TrackedRepresentationFactory {

    /**
     * Creates (POST) a representation in the context of a resource. The resulting representation from the Location header
     * is hydrated and returned.
     *
     * Note: a 201 returns a location whereas the 200 and 202 do not and undef
     *
     * @param resource context in which a resource is created
     * @param document content of the representation
     * @param options
     * @returns a 201 returns a representation whereas the 200 and 202 return undefined
     */
    public static async create<T extends LinkedRepresentation, TResult extends LinkedRepresentation>(
        resource: T | Tracked<T> | FormRepresentation,
        document: DocumentRepresentation,
        options?: ResourceFactoryOptions &
            ResourceQueryOptions &
            ResourceLinkOptions &
            HttpRequestOptions &
            ResourceFetchOptions &
            LoaderJobOptions): Promise<TResult | Tracked<TResult> | undefined> {

        const {
            rel = LinkRelation.Self,
            getUri = LinkUtil.getUri,
        } = { ...options };

        const uri = getUri(resource, rel);

        log.debug('tracked representation create: start');

        if (uri) {

            try {
                const response = await HttpRequestFactory.Instance().create(resource, document, options);

                if (response) {
                    const { headers = {}, status } = response;
                    if (!headers) {
                        // realistically only for tests
                        log.error('response does not like an http request');
                    }

                    // create 201 should have a header and be populated
                    if (status === 201 || !status) {
                        if (!status) {
                            // cater for tests not return status headers
                            log.warn('server not returning status code');
                        }

                        const uri = headers.location;
                        if (uri) {
                            // TODO: decide on pluggable hydration strategy
                            const hydrated = await this.load(
                                SparseRepresentationFactory.make({ ...options, uri }),
                                { ...options, rel: LinkRelation.Self });
                            log.debug('tracked representation created and loaded %s', uri);
                            return hydrated;
                        } else {
                            log.error('create: response no Location header for \'%s\'', uri);
                            // fall through to undefined
                        }

                    } else {
                        // other response codes (200, 202) should be dealt with separately
                        // see https://stackoverflow.com/a/29096228
                        log.warn('response returned %s, no resource processed', status);
                        // fall through to undefined
                    }

                } else {
                    log.error('response not found on http request');
                }

            } catch (e) {
                if (isHttpRequestError(e)) {
                    // errors don't get attached back on the context resource, just log them
                    log.warn(`Request error returning undefined: '${e.message}'}`);
                    // fall through to undefined
                } else {
                    log.warn(`Request error returning undefined`);
                    // fall through to undefined
                }
            }
        } else {
            return Promise.reject(new Error('create tracked representation has no context to find uri to POST on'));
        }

        return undefined;
    }

    public static async del<T extends LinkedRepresentation>(
        resource: T | Tracked<T>,
        options?: ResourceLinkOptions &
            HttpRequestOptions &
            ResourceMergeOptions &
            ResourceQueryOptions &
            LoaderJobOptions): Promise<T | Tracked<T>> {

        if (instanceOfTrackedRepresentation(resource)) {

            const {
                rel = LinkRelation.Self,
                getUri = LinkUtil.getUri,
            } = { ...options };

            const uri = getUri(resource, rel);

            // check uri exists is useful because it picks up early errors in the understanding (or implementation)
            // of the API. It also keeps error out of the loading code below where it would fail too but is harder
            // to diagnose.
            if (uri) {
                const trackedState = TrackedRepresentationUtil.getState(resource);

                switch (trackedState.status) {
                    case Status.virtual:
                        log.info('Resource is client-side only and will not be deleted %s %s', uri, trackedState.status.toString());
                        return resource as unknown as T;
                    case Status.deleted:
                    case Status.deleteInProgress:
                        return Promise.reject(new Error(`Resource 'deleted' unable to delete '${uri}'`));
                    case Status.forbidden: // TODO: enhance forbidden strategy as needed currently assumes forbidden access doesn't change per session
                        log.info('Resource is already forbidden and will not be deleted %s', uri);
                        return resource as unknown as T;
                }

                try {
                    trackedState.previousStatus = trackedState.status;
                    trackedState.status = Status.deleteInProgress;

                    // when was it retrieved - for later queries
                    const response = await HttpRequestFactory.Instance().del(resource, options);

                    trackedState.status = Status.deleted;
                    // mutate the original resource headers
                    // how was it retrieved
                    trackedState.headers = response?.headers;
                    // save the across-the-wire meta data so we can check for collisions/staleness
                    trackedState.retrieved = new Date();

                    return await resource as unknown as T;

                } catch (e) {
                    if (isHttpRequestError(e)) {
                        this.processError(e, uri, resource, trackedState);
                    } else {
                        // throw (e);
                    }
                }
            } else {
                log.error('undefined returned on link \'%s\' (check stack trace)', rel);
            }

        } else {
            // TODO: decide if we want to make a locationOnly resource if possible and then continue
            return Promise.reject(new Error(`delete tracked representation has no state on '${LinkUtil.getUri(resource, LinkRelation.Self)}'`));
        }
        return resource;

    }

    /**
     *
     * @throws
     */
    public static async update<T extends LinkedRepresentation>(
        resource: T | Tracked<T>,
        document: T | DocumentRepresentation<T>,
        options?: ResourceLinkOptions &
            HttpRequestOptions &
            ResourceMergeOptions &
            ResourceFetchOptions &
            LoaderJobOptions): Promise<T | void> {


        if (instanceOfTrackedRepresentation(resource)) {

            const {
                rel = LinkRelation.Self,
                getUri = LinkUtil.getUri,
            } = { ...options };

            const uri = getUri(resource, rel);

            // check uri exists is useful because it picks up early errors in the understanding (or implementation)
            // of the API. It also keeps error out of the loading code below where it would fail too but is harder
            // to diagnose.
            if (uri) {
                const trackedState = TrackedRepresentationUtil.getState(resource);

                try {
                    const response = await HttpRequestFactory.Instance().update(resource, document, options);

                    // mutate the original resource headers
                    // how was it retrieved
                    trackedState.headers = response.headers;
                    // save the across-the-wire meta data so we can check for collisions/staleness
                    trackedState.previousStatus = trackedState.status;
                    trackedState.status = Status.hydrated;
                    // when was it retrieved - for later queries
                    trackedState.retrieved = new Date();

                    return await this.processResource(resource, document, options) as T;

                } catch (e) {
                    // TODO: add options error type detection factory
                    if (isHttpRequestError(e)) {
                        this.processError(e, uri, resource, trackedState);
                    } else {
                        log.warn('TODO: re-throw');
                        // throw(e);
                    }
                }
            } else {
                log.error(`No link rel found for '${rel}'`);
            }

            return resource;
        } else {
            return Promise.reject(new Error(`update tracked representation has no state on '${LinkUtil.getUri(resource, LinkRelation.Self)}'`));
        }

    }

    /**
     * Processes all the hydration rules of the {@link LinkedRepresentation} of whether or not a resource a should
     * be fetched based on its state and http headers.
     *
     * Its responsibility is to deal with the tracking of the representation.
     *
     * TODO: load would ideally NOT come in on a TrackedRepresentation but rather a LinkedRepresentation only
     *
     * @param resource existing resource
     * @param options
     */
    public static async load<T extends LinkedRepresentation>(
        resource: T | Tracked<T>,
        options?: ResourceLinkOptions &
            HttpRequestOptions &
            ResourceMergeOptions &
            ResourceQueryOptions &
            ResourceFetchOptions &
            LoaderJobOptions): Promise<T | Tracked<T>> {

        if (instanceOfTrackedRepresentation(resource)) {

            const {
                rel = LinkRelation.Self,
                getUri = LinkUtil.getUri,
                includeItems = false,
            } = { ...options };

            const uri = getUri(resource, rel);

            // check uri exists is useful because it picks up early errors in the understanding (or implementation)
            // of the API. It also keeps error out of the loading code below where it would fail too but is harder
            // to diagnose.
            if (uri) {
                const trackedState = TrackedRepresentationUtil.getState(resource);

                switch (trackedState.status) {
                    case Status.virtual:
                        log.info('Resource is client-side only and will not be fetched %s %s', uri, trackedState.status.toString());
                        return resource;
                    case Status.deleted:
                        log.info('Resource is already deleted and will not be fetched %s', uri);
                        return resource;
                    case Status.deleteInProgress:
                        log.info('Resource is being deleted and will not be fetched %s', uri);
                        return resource;
                    case Status.forbidden: // TODO: enhance forbidden strategy as needed currently assumes forbidden access doesn't change per session
                        log.info('Resource is already forbidden and will not be fetched %s', uri);
                        return resource;
                }

                // TODO: check if load due to cache expiry is required.
                if (TrackedRepresentationUtil.needsFetchFromState(resource, options) ||
                    TrackedRepresentationUtil.needsFetchFromHeaders(resource)) {
                    try {
                        const response = await HttpRequestFactory.Instance().load(resource, rel, options);

                        // mutate the original resource headers
                        // how was it retrieved
                        trackedState.headers = response.headers;
                        // save the across-the-wire meta data so we can check for collisions/staleness
                        trackedState.previousStatus = trackedState.status;
                        trackedState.status = Status.hydrated;
                        // when was it retrieved - for later queries
                        trackedState.retrieved = new Date();

                        return await this.processResource(resource, response.data as DocumentRepresentation<T>, options) as T;
                    } catch (e: unknown) {
                        if (isHttpRequestError(e)) {
                            this.processError<T>(e, uri, resource, trackedState);
                        } else {
                            log.warn('Unhandled http exception %o', e);
                            // throw(e);
                        }
                    }
                } else {
                    // Iff the resource is a collection, then if the collection has been loaded (hydrated), and
                    // the caller has requested the items be loaded, then iterate over the individual items
                    // to check they are loaded.
                    if (instanceOfCollection(resource)) {
                        if (includeItems) {
                            await this.processCollectionItems(resource, options);
                        }
                    }
                }
            } else {
                log.error('undefined returned on link \'%s\' (check stack trace)', rel);
            }
        } else {
            const uri = LinkUtil.getUri(resource, LinkRelation.Self);
            if (uri) {
                log.debug('tracked representation created: unknown on \'%s\'', uri);
                const unknown = SparseRepresentationFactory.make(
                    { ...options, addStateOn: resource, status: Status.unknown });
                return await TrackedRepresentationFactory.load(unknown, options) as T;
            } else {
                log.error('load tracked representation has no processable uri');
            }
        }
        return resource;
    }

    /**
     * Removes the item from the collection by matching its Self link. If not found, it returns undefined.
     * If an items is removed from a collection, it is marked as 'stale'
     */
    public static removeCollectionItem<T extends LinkedRepresentation>(
        collection: CollectionRepresentation<T> | Tracked<CollectionRepresentation<T>>,
        item: T): T | undefined {

        const itemFromCollection = RepresentationUtil.removeItemFromCollection(collection, item);
        if (instanceOfTrackedRepresentation(itemFromCollection)) {
            const trackedState = TrackedRepresentationUtil.getState(itemFromCollection);
            trackedState.previousStatus = trackedState.status;
            trackedState.status = Status.stale;
            return itemFromCollection;
        }
        return undefined;
    }

    /**
     * Updates the state object based on the error
     *
     * TODO: add client status errors to state for surfacing field validations errors
     *          - this will require an error processing factory given most system
     *            present these errors differently
     *
     * TODO: add onErrorHandling strategy (eg throw or quiet)
     */
    private static processError<T extends LinkedRepresentation>(e: HttpRequestError, uri: Uri, resource: T, trackedState: State): void {
        const { response } = e;
        if (response) {

            if (response.status === 403) {
                log.debug(`Request forbidden ${response.status} ${response.statusText} '${uri}'`);
                // save the across-the-wire meta data so we can check for collisions/staleness
                trackedState.status = Status.forbidden;
                // when was it retrieved
                trackedState.retrieved = new Date();
                // how was it retrieved
                trackedState.headers = response.headers;
                /**
                 * On a forbidden resource we are going to let the decision of what to do with
                 * it lie at the application level. So we'll set the state, etc and return the
                 * resource. This means that the application needs to check if it is {@link Status.forbidden}
                 * and decide whether to remove (from say the set, or in the UI dim the item).
                 */
            } else if (response.status === 404) {
                const message = `Likely stale collection for '${LinkUtil.getUri(resource, LinkRelation.Self)}' on resource ${uri}`;
                log.info(message);
                trackedState.status = Status.deleted;
                // TODO: this should return a Promise.reject for it to be dealt with
                throw new Error(message);
            } else if (response.status >= 400 && response.status < 499) {
                log.info(`Client error '${response.statusText}' on resource ${uri}`);
                trackedState.status = Status.unknown;
            } else if (response.status >= 500 && response.status < 599) {
                log.info(`Server error '${response.statusText}' on resource ${uri}`);
                trackedState.status = Status.unknown;
            } else {
                log.error(`Request error: '${e.message}'}`);
                log.debug(e.stack);
                trackedState.status = Status.unknown;
                /**
                 * We really don't know what is happening here. But allow the application
                 * to continue.
                 */
            }
        }
    }

    private static async processResource<T extends LinkedRepresentation>(
        resource: T,
        data: T | DocumentRepresentation<T> | FeedRepresentation,
        options?: (ResourceLinkOptions & HttpRequestOptions & ResourceMergeOptions & ResourceFetchOptions)): Promise<T | CollectionRepresentation<T>> {
        if (instanceOfFeed(data)) {
            return await this.processCollection(resource as unknown as CollectionRepresentation<T>, data, options);
        } else {
            return await this.processSingleton(resource as T, data, options);
        }
    }


    /**
     * Ensures the in-memory collection resource and its items are up-to-date with the server with
     * the number of items matching and all items at least sparsely populated. Use 'includeItems' flag
     * to fully hydrate each item.
     */
    private static async processCollection<T extends LinkedRepresentation>(
        resource: CollectionRepresentation<T>,
        data: FeedRepresentation,
        options ?: ResourceLinkOptions &
            HttpRequestOptions &
            ResourceMergeOptions &
            ResourceFetchOptions &
            ResourceQueryOptions &
            LoaderJobOptions): Promise<CollectionRepresentation<T>> {
        const { rel = LinkRelation.Self, includeItems } = { ...options };

        const uri = LinkUtil.getUri(resource, rel);

        if (!uri) {
            throw new Error('no uri found');
        }

        // ensure that all the items are sparsely populated
        const fromFeed = SparseRepresentationFactory.make<CollectionRepresentation<T>>({
            ...options,
            uri,
            sparseType: 'collection',
            addStateOn: data,
        });

        // merge the existing and the response such that
        //  - any in existing but not in response are removed from existing
        //  - any in response but not in existing are added
        // the result is to reduce network retrieval because existing hydrated items are not response
        resource = CollectionMerger.merge(resource, fromFeed, options);

        // hydrate items is required (also, merged hydrated items won't go back across the network
        // unless there is a {@link forceLoad}
        // disable force load on collections items for items only when {@forceLoadFeedOnly} is set
        if (includeItems) {
            await this.processCollectionItems(resource, options);
        }

        // now merge the collection (attributes) (and do so with observers to trigger)
        // return SingletonMerger.merge(resource2, representation, options);
        return resource;
    }


    private static async processCollectionItems<T extends LinkedRepresentation>(
        resource: CollectionRepresentation<T>,
        options?: (ResourceLinkOptions &
            HttpRequestOptions &
            ResourceMergeOptions &
            ResourceFetchOptions &
            ResourceQueryOptions &
            LoaderJobOptions)): Promise<void> {

        const { forceLoad, forceLoadFeedOnly, batchSize = 1 } = { ...options };

        if (forceLoad && forceLoadFeedOnly) {
            options = { ...options, forceLoad: false };
        }

        /**
         * Iterating over the resource(s) and use the options for the iterator. The batch size
         * indicates at this stage whether the queries or sequential or parallel (ie batch size is a bit misleading
         * because in practice batch size is either one (sequential) or all (parallel). This can be extended when needed.
         */
        const waitAll = (batchSize > 0) ? parallelWaitAll : sequentialWaitAll;
        options = { ...options, rel: LinkRelation.Self };

        await waitAll(resource, async item => {
            await this.load(item, options);
        });
    }

    /**
     * Ensures the in-memory resource is up-to-date with the server. Synchronising needs to
     * occur within the context of this {@link State} object so that {@link State.status} flag of
     * the to-be-retrieved resource is in context.
     *
     * Note: singleton also processes a form and may need to be separated for deep merge of items
     */
    private static async processSingleton<T extends LinkedRepresentation, U extends T | DocumentRepresentation<T> = T>(
        resource: T,
        representation: U,
        options ?: ResourceLinkOptions &
            HttpRequestOptions &
            ResourceMergeOptions &
            ResourceFetchOptions &
            LoaderJobOptions): Promise<Extract<U, T>> {

        return SingletonMerger.merge(resource, representation, options);
    }

}
