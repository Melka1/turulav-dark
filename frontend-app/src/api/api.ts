import { createApi } from '@reduxjs/toolkit/query';
import { baseQuery } from './baseQuery';

export const api = createApi({
  reducerPath: 'api',
  baseQuery,
  tagTypes: [
    'Me',
    'Profile',
    'Users',
    'Profiles',
    'Search',
    'Friends',
    'FriendStatus',
    'FriendRequests',
    'Blocks',
    'ActivityFeed',
    'Post',
    'Favorites',
    'Comments',
    'BlogPosts',
    'BlogPost',
    'BlogComments',
    'BlogTags',
    'UserMedia',
  ],
  endpoints: () => ({}),
});
