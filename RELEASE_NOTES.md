DCubeJS Release Notes
=====================

### Version 0.2 April 26th, 2010
--------------------------------

One day after the first release there is a bug fix regarding the caching of
user objects created using the .connect() interface. It used to be that after
submitting an invalid passkey through .user() or connect() would result it all
calls to all authenticated methods of the returned user object to result in an
invalid passkey error even after connect() had been called with the correct
passkey. The fix was to pass the `force` flag to .user(), forcing it to bypass
the user in the cache and create a new one. Now, any call to .connect() also
forces .user() to bypass the cache so invalid passkeys can be corrected just by
using .connect().

### Version 0.1 April 25th, 2010
--------------------------------

This is the initial release. Currently DCubeJS only works as a JavaScript
module on the Mozilla platform with `Components.utils.import()`. The
documentation and road map does not exist yet, so don't go looking for it.

