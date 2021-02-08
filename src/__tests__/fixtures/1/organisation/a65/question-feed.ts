import { self as questionUri } from '../../question/cf6-question';
import { self as creatFormUri } from '../../question/form/create';

export const self = 'https://api.example.com/organisation/a656927b0f/question';
export const resource = {
    links:
        [
            {
                rel: 'self',
                href: self,
            },
            {
                rel: 'create-form',
                href: creatFormUri,
            },
        ],
    items: [
        {
            id: questionUri,
            title: 'Please tell me about yourself (AgainXXXXX)',
        },
    ],
};
