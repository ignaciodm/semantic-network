import { LinkedRepresentation } from 'semantic-link';
import { assertThat } from 'mismatched';
import { HttpRequestFactory } from '../http/httpRequestFactory';
import TrackedRepresentationUtil from '../utils/trackedRepresentationUtil';
import { singletonRepresentation } from './helpers/representationMatcher';
import { Status } from '../representation/status';
import SparseRepresentationFactory from '../representation/sparseRepresentationFactory';
import NamedRepresentationFactory from '../representation/namedRepresentationFactory';
import { TrackedRepresentation } from '../types/types';
import RepresentationUtil from '../utils/representationUtil';
import LinkRelation from '../linkRelation';

const makeHydratedResource = <T extends LinkedRepresentation>(document: T): TrackedRepresentation<T> =>
    // note: clone the document for multiple uses
    SparseRepresentationFactory.make({ on: { ...document } });

describe('Named Representation Factory', () => {

    const post = jest.fn();
    const get = jest.fn();
    const put = jest.fn();
    const del = jest.fn();

    HttpRequestFactory.Instance(
        { postFactory: post, getFactory: get, putFactory: put, deleteFactory: del }, true);

    function verifyMocks(getCount: number, postCount: number, putCount: number, deleteCount: number): void {
        assertThat({
            get: get.mock.calls.length,
            post: post.mock.calls.length,
            put: put.mock.calls.length,
            del: del.mock.calls.length,
        }).is({
            get: getCount,
            post: postCount,
            put: putCount,
            del: deleteCount,
        });
    }

    afterEach(() => {
        post.mockReset();
    });

    describe('load', () => {

        interface ApiRepresentation extends LinkedRepresentation {
            version: string;
            me?: MeRepresentation;
        }

        interface MeRepresentation extends LinkedRepresentation {
            data: string;
        }

        const uri = 'https://api.example.com';

        test.each([
            [{} as TrackedRepresentation<ApiRepresentation>, 'No named resource (or rel) specified'],
        ])('no rel or name, throws', async (representation: TrackedRepresentation<ApiRepresentation>, err: string) => {
            await expect(async () => await NamedRepresentationFactory.load(representation, {})).rejects.toEqual(err);
            expect(post).not.toHaveBeenCalled();
        });

        test.each([
            ['me', true],
            ['not', undefined],
        ])('on rel, \'%s\'', async (rel: string, returns: boolean | undefined) => {

            const api = makeHydratedResource<ApiRepresentation>({
                links: [{ rel: LinkRelation.Self, href: uri }, { rel: 'me', href: 'http://example.com/me' }],
                version: '1.0.0',
            });
            const me = {
                links: [{ rel: LinkRelation.Self, href: 'http://example.com/me' }],
                data: 'XXX',
            };
            get
                .mockResolvedValue(
                    {
                        data: { ...me },
                        headers: {},
                        status: 200,
                        statusText: '',
                        config: {},
                    }
                );

            const actual = await NamedRepresentationFactory.load(api, { rel });

            if (returns) {
                verifyMocks(1, 0, 0, 0);
                expect(get).toHaveBeenCalled();
                expect(actual).toBeDefined();
                // the inside load "fails" returning the location only
                if (actual) {
                    const { status } = TrackedRepresentationUtil.getState(actual);
                    assertThat(actual).is(singletonRepresentation);
                    assertThat(status).is(Status.hydrated);
                    const name = NamedRepresentationFactory.defaultNameStrategy(rel) as keyof ApiRepresentation;
                    assertThat(RepresentationUtil.getProperty(api, name)).is(actual);
                    assertThat(TrackedRepresentationUtil.isTracked(api, name)).is(true);
                }
            } else {
                verifyMocks(0, 0, 0, 0);
                expect(get).not.toHaveBeenCalled();
                expect(actual).toBeUndefined();
            }
            post.mockReset();
        })
        ;

    })
    ;
})
;
