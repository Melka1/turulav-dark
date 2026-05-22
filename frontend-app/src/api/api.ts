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
    'ActivityFeed',
    'Post',
    'Favorites',
    'Comments',
  ],
  endpoints: () => ({}),
});
