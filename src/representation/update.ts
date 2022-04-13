import { instanceOfUriList } from '../utils/instanceOf';
import { LinkedRepresentation, LinkUtil } from 'semantic-link';
import { ResourceUpdateOptions } from '../interfaces/ResourceUpdateOptions';
import anylogger from 'anylogger';
import { LinkRelation } from '../linkRelation';
import { defaultEditFormStrategy } from './editFormMergeStrategy';
import { get } from './get';
import { Tracked } from '../types/types';
import { DocumentRepresentation } from '../interfaces/document';
import { TrackedRepresentationFactory } from './trackedRepresentationFactory';
import { ResourceLinkOptions } from '../interfaces/resourceLinkOptions';
import { HttpRequestOptions } from '../interfaces/httpRequestOptions';
import { ResourceMergeOptions } from '../interfaces/resourceAssignOptions';
import { ResourceFetchOptions } from '../interfaces/resourceFetchOptions';
import { instanceOfForm } from '../utils/instanceOf/instanceOfForm';
import { instanceOfCollection } from '../utils/instanceOf/instanceOfCollection';

const log = anylogger('Update');

/**
 * Update on existing resource
 *      TODO: accept but don't require TrackedRepresentation interface
 *      TODO: always returns resource but hard to know if error. Either throw or return undefined
 *            Note: underlying TrackedRepresentationFactory.update has this strategy
 */
export async function update<T extends LinkedRepresentation>(
    resource: T | Tracked<T>,
    document: T | DocumentRepresentation<T>,
    options?: ResourceUpdateOptions &
        ResourceLinkOptions &
        HttpRequestOptions &
        ResourceMergeOptions &
        ResourceFetchOptions): Promise<T> {

    // PATCH
    if (instanceOfCollection(resource)) {
        if (!instanceOfUriList(document)) {
            log.debug(resource, document, options);
            throw new Error('To update a collection, a document of type UriList must be supplied');
        }
        throw new Error('Update collection not implemented');
    }

    // PUT
    // update a single resource
    return updateSingleton(resource, document, options);
}

/**
 *  Update a singleton.
 *
 *  If the singleton has a form relation (default: edit-form) then construction the across-the-wire
 *  PUT representation from only the form attributes. Otherwise, take the incoming documentation as given.
 *  @throws
 */
async function updateSingleton<T extends LinkedRepresentation>(
    resource: T | Tracked<T>,
    document: T | DocumentRepresentation<T>,
    options?: ResourceUpdateOptions &
        ResourceLinkOptions &
        HttpRequestOptions &
        ResourceMergeOptions &
        ResourceFetchOptions): Promise<T> {

    if (!document) {
        log.debug('No document provided to update for resource %s', LinkUtil.getUri(resource, LinkRelation.Self));
        return resource;
    }

    const { formRel = LinkRelation.EditForm } = { ...options };

    if (LinkUtil.matches(resource, formRel)) {
        const form = await get(resource, { ...options, rel: formRel });
        if (instanceOfForm(form)) {

            const { makePutRepresentationStrategy = defaultEditFormStrategy } = { ...options };
            const representation = await makePutRepresentationStrategy(resource, document, form, options);

            if (representation) {
                // WARNING: this has under-baked error reporting and does not throw errors
                await TrackedRepresentationFactory.update(resource, representation, options);
                return resource;
            } else {
                log.debug(
                    'No update required based on form for \'%s\'',
                    LinkUtil.getUri(resource, LinkRelation.Self));
                return resource;
            }

        } else {
            log.warn(
                'Update link \'%s\' on \'%s\' is not a form',
                formRel,
                LinkUtil.getUri(resource, LinkRelation.Self));
            // drop through to use handed in document
        }
    } else {
        log.debug(
            'Update without form - resource has no \'%s\' form on  \'%s\'',
            formRel,
            LinkUtil.getUri(resource, LinkRelation.Self));
    }

    // WARNING: this has under-baked error reporting and does not throw errors
    await TrackedRepresentationFactory.update(resource, document, options);
    return resource;
}
