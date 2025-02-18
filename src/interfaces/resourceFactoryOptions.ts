import { Status } from '../representation/status';
import { LinkedRepresentation, Uri } from 'semantic-link';
import { FeedItemRepresentation } from 'semantic-link/lib/interfaces';
import { Tracked } from '../types/types';

export type ResourceType = 'singleton' | 'collection' | 'feed';

export type MakeSparseStrategy = (options?: ResourceFactoryOptions) => Tracked<LinkedRepresentation>;

export interface ResourceFactoryOptions {

    /**
     * The href set on the 'Self' link relation
     */
    readonly uri?: Uri;

    /**
     * The title set on the sparsely populate resource.
     */
    readonly title?: string;

    /**
     * Explicitly set the {@link State.status} on the resource. Currently, when there is a uri, it is set to location
     * otherwise, set to unknown
     *
     * @see TrackedRepresentationFactory.make
     * @see State
     */
    readonly status?: Status;

    /**
     * Where the resource is sparse, the type can be explicitly set. Default is singleton
     *
     * Note: 'feed' is an internal type that generally should not be used/needed.
     */
    readonly sparseType?: ResourceType;

    /**
     * For {@link ResourceType} collection, default items can be added at creation time. Items are added as sparse representations
     */
    readonly defaultItems?: (Uri | FeedItemRepresentation)[];

    /**
     * Set a state on this data if it exists rather than a sparsely populated representation.
     *
     * When set with a {@link LinkedRepresentation}, the {@link State} will be initialised on the representation.
     * An initialised representation will be at worst sparse with a state ({@link Status.locationOnly}, {@link Status.virtual}).
     * At best, the representation is {@link Status.hydrated} when a resource is presented that has been retrieved across the wire.
     */
    readonly addStateOn?: LinkedRepresentation;

    /**
     * Internally used, to generate a items on a collection. Used in conjunction with {@link sparseType} 'feed'.
     */
    readonly feedItem?: FeedItemRepresentation;

    readonly mappedTitle?: string;

    /**
     * The strategy used to create sparse {@link LinkedRepresentation} objects. This allows to caller
     * to plug in an alternative implementation (say to implement a pooled resource strategy).
     */
    readonly makeSparseStrategy?: MakeSparseStrategy;
}
